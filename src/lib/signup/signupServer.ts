// src/lib/signup/signupServer.ts
// Η αυτόματη εγγραφή με τη βάση — ΜΟΝΟ server. Καθαρή λογική: signup.ts,
// slug.ts, token.ts, onboarding.ts. Τα routes (api/auth/signup|verify-email|
// resend-verification) απλώς συνδέουν και ελέγχουν τον διακόπτη.
//
// · ΜΙΑ transaction: εταιρία + Διαχειριστής + βασικό συμβόλαιο (ο ΙΔΙΟΣ
//   μηχανισμός με τον Super Admin, tenantCreate.ts) + token επαλήθευσης.
// · Υπάρχον email: τίποτα δεν φτιάχνεται, ουδέτερο email, ΙΔΙΑ απάντηση.
//   Το bcrypt τρέχει ΠΑΝΤΑ (ίδιος χρόνος απάντησης).
// · Όρια ανά IP/email: ο κοινός μηχανισμός (LIMITS + rate_limits).

import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { hitLimit, LIMITS } from "../public/rateLimit";
import { dbCounterStore } from "../public/rateLimitStore";
import { normalizeLocale } from "../i18n/locale";
import { loginDecision } from "../loginCore";
import type { JWTPayload } from "../auth";
import { BCRYPT_ROUNDS, createTenantWithAdmin } from "../tenantCreate";
import { platformOrigin, readPlatformEnv } from "../storefront/domain";
import { sendSignupEmail } from "./mailer";
import { initialOnboardingState } from "./onboarding";
import {
  RESEND_NEUTRAL,
  SIGNUP_ERRORS,
  SIGNUP_NEUTRAL,
  existingAccountEmail,
  isHoneypotFilled,
  signupLang,
  verificationEmail,
  type SignupEmail,
  type SignupInput,
  type SignupLang,
} from "./signup";
import { UNVERIFIED_CLEANUP_DAYS, createVerifyToken, hashToken, isTokenShape, tokenState, verifyUrl } from "./token";
import { uniqueSlug } from "./slug";

export type FlowResult =
  | { status: 200; body: { message: string; testEmail?: SignupEmail } }
  | { status: 400 | 429; body: { message: string; code: string } };

/** Η βάση των συνδέσμων: PLATFORM_URL αν υπάρχει, αλλιώς το origin του αιτήματος. */
export function linkOrigin(requestOrigin: string): string {
  const env = readPlatformEnv();
  return (env.PLATFORM_URL && platformOrigin({ PLATFORM_URL: env.PLATFORM_URL })) || requestOrigin;
}

const neutral = (lang: SignupLang, testEmail?: SignupEmail): FlowResult => ({
  status: 200,
  body: { message: SIGNUP_NEUTRAL[lang], ...(testEmail ? { testEmail } : {}) },
});

const tooMany = (lang: SignupLang): FlowResult => ({
  status: 429,
  body: { message: SIGNUP_ERRORS.rateLimit[lang], code: "rate_limit" },
});

/** Υπάρχει ήδη λογαριασμός ή εταιρία με αυτό το email; */
async function emailInUse(email: string): Promise<boolean> {
  const [user, tenant] = await Promise.all([
    db.user.findUnique({ where: { email }, select: { id: true } }),
    db.tenant.findUnique({ where: { email }, select: { id: true } }),
  ]);
  return Boolean(user || tenant);
}

/** Slug ελεύθερο ΚΑΙ ως login slug ΚΑΙ ως /s/<slug>. */
async function slugTaken(slug: string): Promise<boolean> {
  const t = await db.tenant.findFirst({
    where: { OR: [{ slug }, { storefrontSlug: slug }] },
    select: { id: true },
  });
  return Boolean(t);
}

const isUniqueOn = (e: unknown, field: string) =>
  e instanceof Prisma.PrismaClientKnownRequestError &&
  e.code === "P2002" &&
  JSON.stringify(e.meta?.target ?? "").includes(field);

export async function signupFlow(input: SignupInput, ip: string, requestOrigin: string): Promise<FlowResult> {
  const lang = signupLang(input.lang);

  // Bot: «επιτυχία» χωρίς τίποτα (ούτε όριο, ούτε βάση, ούτε email).
  if (isHoneypotFilled(input.website)) return neutral(lang);

  if (!(await hitLimit(dbCounterStore, LIMITS.signupPerIp, ip))) return tooMany(lang);
  if (!(await hitLimit(dbCounterStore, LIMITS.signupPerEmail, input.email))) return tooMany(lang);

  const origin = linkOrigin(requestOrigin);
  // ΠΑΝΤΑ (και για υπάρχον email): ίδιος χρόνος απάντησης.
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  if (await emailInUse(input.email)) {
    const mail = await sendSignupEmail(existingAccountEmail(lang, input.email, `${origin}/login`));
    return neutral(lang, mail.testEmail);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = await uniqueSlug(input.companyName, slugTaken);
    const tok = createVerifyToken();
    try {
      await db.$transaction(async (tx) => {
        const { user } = await createTenantWithAdmin(tx, {
          name: input.companyName,
          slug,
          email: input.email,
          storefrontSlug: slug,
          signupSource: "self_signup",
          onboardingState: initialOnboardingState() as unknown as Prisma.InputJsonValue,
          admin: { name: input.ownerName, email: input.email, passwordHash, emailVerifiedAt: null, locale: lang },
        });
        await tx.emailVerificationToken.create({
          data: { userId: user.id, tokenHash: tok.tokenHash, expiresAt: tok.expiresAt },
        });
      });
    } catch (e) {
      // Ταυτόχρονη εγγραφή: το UNIQUE index αποφασίζει.
      if (isUniqueOn(e, "email")) {
        const mail = await sendSignupEmail(existingAccountEmail(lang, input.email, `${origin}/login`));
        return neutral(lang, mail.testEmail);
      }
      if (isUniqueOn(e, "slug") || isUniqueOn(e, "storefrontSlug")) continue;
      throw e;
    }
    const mail = await sendSignupEmail(verificationEmail(lang, input.email, input.ownerName, verifyUrl(origin, tok.token)));
    return neutral(lang, mail.testEmail);
  }
  throw new Error("signup: slug conflicts");
}

/** «Ξαναστείλε email»: νέο token (τα παλιά ακυρώνονται) ΜΟΝΟ για λογαριασμό που περιμένει. */
export async function resendFlow(email: string, rawLang: unknown, ip: string, requestOrigin: string): Promise<FlowResult> {
  const lang = signupLang(rawLang);
  if (!(await hitLimit(dbCounterStore, LIMITS.verifyResendPerIp, ip))) return tooMany(lang);
  if (!(await hitLimit(dbCounterStore, LIMITS.verifyResendPerEmail, email))) return tooMany(lang);

  const user = await db.user.findFirst({
    where: { email, emailVerifiedAt: null, isActive: true, tenant: { signupSource: "self_signup" } },
    select: { id: true, name: true, locale: true },
  });
  const ok: FlowResult = { status: 200, body: { message: RESEND_NEUTRAL[lang] } };
  if (!user) return ok;

  const now = new Date();
  const tok = createVerifyToken(now);
  await db.$transaction([
    db.emailVerificationToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
    db.emailVerificationToken.create({ data: { userId: user.id, tokenHash: tok.tokenHash, expiresAt: tok.expiresAt } }),
  ]);
  const mail = await sendSignupEmail(verificationEmail(lang, email, user.name, verifyUrl(linkOrigin(requestOrigin), tok.token)));
  return mail.testEmail ? { status: 200, body: { ...ok.body, testEmail: mail.testEmail } } : ok;
}

export type VerifyResult =
  | { ok: true; session: JWTPayload }
  | { ok: false; status: 400 | 429; code: "invalid" | "expired" | "used" | "blocked" | "rate_limit"; message: string };

/**
 * Επαλήθευση: token έγκυρο, μη ληγμένο, αχρησιμοποίητο → usedAt ΑΤΟΜΙΚΑ (ένα
 * updateMany με όλους τους όρους) + emailVerifiedAt. Επιστρέφει τη συνεδρία για
 * την αυτόματη σύνδεση (ίδια με του login).
 */
export async function verifyFlow(rawToken: unknown, rawLang: unknown, ip: string, now = new Date()): Promise<VerifyResult> {
  const lang = signupLang(rawLang);
  if (!(await hitLimit(dbCounterStore, LIMITS.verifyPerIp, ip))) {
    return { ok: false, status: 429, code: "rate_limit", message: SIGNUP_ERRORS.rateLimit[lang] };
  }
  const invalid: VerifyResult = { ok: false, status: 400, code: "invalid", message: SIGNUP_ERRORS.verifyInvalid[lang] };
  if (!isTokenShape(rawToken)) return invalid;

  const row = await db.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  const state = tokenState(row, now);
  if (state === "expired") return { ok: false, status: 400, code: "expired", message: SIGNUP_ERRORS.verifyExpired[lang] };
  if (state !== "ok" || !row) return { ...invalid, code: state === "used" ? "used" : "invalid" } as VerifyResult;

  const used = await db.$transaction(async (tx) => {
    const claim = await tx.emailVerificationToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claim.count !== 1) return false;
    await tx.user.updateMany({ where: { id: row.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
    // Κάθε άλλος σύνδεσμος του ίδιου χρήστη παύει να ισχύει.
    await tx.emailVerificationToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
    return true;
  });
  if (!used) return { ...invalid, code: "used" } as VerifyResult;

  const user = await db.user.findUnique({
    where: { id: row.userId },
    include: { tenant: { select: { slug: true, status: true } } },
  });
  const decision = loginDecision(user, true);
  if (!user || !decision.ok) return { ok: false, status: 400, code: "blocked", message: decision.ok ? invalid.message : decision.message };

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
  return {
    ok: true,
    session: {
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tenantSlug: user.tenant?.slug || null,
      name: user.name,
      locale: normalizeLocale(user.locale),
    },
  };
}

/* ── Καθάρισμα (Super Admin, όχι αυτόματη διαγραφή) ── */

export interface CleanupCandidate {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  cleanupFlaggedAt: string | null;
}

/**
 * Εταιρίες από εγγραφή που ΔΕΝ επαληθεύτηκαν σε 7 ημέρες (κανένας χρήστης με
 * emailVerifiedAt). Cron-ready: καθαρή συνάρτηση χωρίς αίτημα.
 */
export async function unverifiedSignups(now = new Date(), days = UNVERIFIED_CLEANUP_DAYS): Promise<CleanupCandidate[]> {
  const rows = await db.tenant.findMany({
    where: {
      signupSource: "self_signup",
      createdAt: { lt: new Date(now.getTime() - days * 86_400_000) },
      users: { none: { emailVerifiedAt: { not: null } } },
    },
    select: { id: true, name: true, email: true, createdAt: true, cleanupFlaggedAt: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    cleanupFlaggedAt: r.cleanupFlaggedAt?.toISOString() ?? null,
  }));
}

/** Σήμανση για καθάρισμα — ΜΟΝΟ σήμανση· η διαγραφή μένει χειροκίνητη. */
export async function flagUnverifiedSignups(now = new Date()): Promise<number> {
  const ids = (await unverifiedSignups(now)).filter((c) => !c.cleanupFlaggedAt).map((c) => c.id);
  if (ids.length === 0) return 0;
  const r = await db.tenant.updateMany({
    where: { id: { in: ids }, signupSource: "self_signup", cleanupFlaggedAt: null },
    data: { cleanupFlaggedAt: now },
  });
  return r.count;
}
