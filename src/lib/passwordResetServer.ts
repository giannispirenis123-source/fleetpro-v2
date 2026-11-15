// src/lib/passwordResetServer.ts
// «Ξέχασα τον κωδικό μου» — η σύνδεση με τη βάση και το Resend. ΜΟΝΟ server.
// Κανόνες και κείμενα: passwordReset.ts. Πίνακας/στήλη: SQL 41.
//
// · requestReset: ΠΑΝΤΑ η ίδια απάντηση (RESET_MESSAGES.neutral) και ελάχιστος
//   χρόνος απάντησης — δεν φαίνεται αν το email αντιστοιχεί σε λογαριασμό.
// · performReset: το token καταναλώνεται ΑΤΟΜΙΚΑ (updateMany με usedAt IS NULL)
//   στην ίδια transaction με τον νέο κωδικό· το passwordChangedAt ακυρώνει
//   κάθε ανοιχτή σύνδεση του χρήστη. Καμία αυτόματη σύνδεση μετά.
// · Στα logs ποτέ email, token ή σύνδεσμος.

import bcrypt from "bcryptjs";
import { Resend } from "resend";
import { db } from "./db";
import { classifyProviderError } from "./invoiceEmail";
import { hitLimit, LIMITS } from "./public/rateLimit";
import { dbCounterStore } from "./public/rateLimitStore";
import { hashToken, tokenState } from "./signup/token";
import type { SignupEmail, SignupLang } from "./signup/signup";
import { passwordChangeStamp } from "./viewerCore";
import { TIMEOUTS, withTimeout } from "./withTimeout";
import { RESET_MESSAGES, canReceiveReset, createResetToken, resetEmail, resetUrl } from "./passwordReset";

/** Ίδια rounds με κάθε άλλο σημείο που γράφει κωδικό. */
const BCRYPT_ROUNDS = 12;

/** Κάθε απάντηση του «στείλε σύνδεσμο» φεύγει μετά από ΤΟΥΛΑΧΙΣΤΟΝ τόσο χρόνο. */
export const FORGOT_MIN_RESPONSE_MS = 1500;

export type ResetFlowResult = { status: 200 | 400 | 429; message: string };

async function send(email: SignupEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error("[FleetPro] email επαναφοράς κωδικού: λείπει το RESEND_API_KEY");
    return;
  }
  const from = process.env.EMAIL_FROM?.trim() || "onboarding@resend.dev";
  try {
    const { error } = await withTimeout(
      new Resend(apiKey).emails.send({ from, to: email.to, subject: email.subject, text: email.text, html: email.html }),
      TIMEOUTS.email,
      "email"
    );
    if (error) console.error(`[FleetPro] email επαναφοράς κωδικού: ${classifyProviderError(error)}`);
  } catch (e) {
    console.error(`[FleetPro] email επαναφοράς κωδικού: ${classifyProviderError(e)}`);
  }
}

const pad = async (started: number) => {
  const wait = FORGOT_MIN_RESPONSE_MS - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
};

/** «Στείλε μου σύνδεσμο». `origin` = η βάση του συνδέσμου (PLATFORM_URL ή το origin του αιτήματος). */
export async function requestReset(email: string, lang: SignupLang, ip: string, origin: string, now = new Date()): Promise<ResetFlowResult> {
  const started = Date.now();
  if (!(await hitLimit(dbCounterStore, LIMITS.passwordForgotPerIp, ip, now))) {
    await pad(started);
    return { status: 429, message: RESET_MESSAGES.rateLimit[lang] };
  }
  // Όριο ανά email: ΔΕΝ αλλάζει την απάντηση — απλώς δεν φεύγει άλλο email.
  const emailOk = await hitLimit(dbCounterStore, LIMITS.passwordForgotPerEmail, email, now);
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, isActive: true, emailVerifiedAt: true, tenant: { select: { status: true } } },
  });
  if (emailOk && user && canReceiveReset(user)) {
    const t = createResetToken(now);
    await db.$transaction([
      // Νέο αίτημα ακυρώνει τα προηγούμενα του ίδιου χρήστη.
      db.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      db.passwordResetToken.create({ data: { userId: user.id, tokenHash: t.tokenHash, expiresAt: t.expiresAt } }),
    ]);
    await send(resetEmail(lang, user.email, user.name, resetUrl(origin, t.token, lang)));
  }
  await pad(started);
  return { status: 200, message: RESET_MESSAGES.neutral[lang] };
}

/** Ορισμός νέου κωδικού με τον σύνδεσμο του email. */
export async function performReset(token: string, password: string, lang: SignupLang, ip: string, now = new Date()): Promise<ResetFlowResult> {
  if (!(await hitLimit(dbCounterStore, LIMITS.passwordResetPerIp, ip, now))) {
    return { status: 429, message: RESET_MESSAGES.rateLimit[lang] };
  }
  const bad: ResetFlowResult = { status: 400, message: RESET_MESSAGES.badLink[lang] };
  const row = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { isActive: true, emailVerifiedAt: true, tenant: { select: { status: true } } } },
    },
  });
  if (!row || tokenState(row, now) !== "ok" || !canReceiveReset(row.user)) return bad;

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const done = await db.$transaction(async (tx) => {
    // Μία χρήση: δύο ταυτόχρονα αιτήματα με το ίδιο token → περνά ΜΟΝΟ το ένα.
    const used = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (used.count !== 1) return false;
    await tx.user.update({
      where: { id: row.userId },
      // passwordChangedAt: κάθε ανοιχτή σύνδεση του χρήστη παύει να ισχύει.
      data: { passwordHash, passwordChangedAt: passwordChangeStamp(now) },
    });
    await tx.passwordResetToken.deleteMany({ where: { userId: row.userId, id: { not: row.id } } });
    return true;
  });
  return done ? { status: 200, message: RESET_MESSAGES.done[lang] } : bad;
}
