// src/lib/passwordReset.ts
// «Ξέχασα τον κωδικό μου» — ΚΑΘΑΡΗ λογική (tests χωρίς βάση). SQL 41.
//
// · Το token (32 τυχαία bytes, base64url) ταξιδεύει ΜΟΝΟ μέσα στο email· στη
//   βάση ΜΟΝΟ το sha256 hash (ίδιος μηχανισμός με την επαλήθευση email).
// · Λήξη 60 λεπτά, μίας χρήσης. Νέο αίτημα ακυρώνει τα παλιά του χρήστη.
// · Η απάντηση του «στείλε σύνδεσμο» είναι ΠΑΝΤΑ η ίδια, όποιο email κι αν
//   δοθεί (υπάρχει / δεν υπάρχει / ανενεργός): καμία απαρίθμηση λογαριασμών.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { hashToken, type NewToken } from "./signup/token";
import { normalizeEmail, wrap, type SignupEmail, type SignupLang } from "./signup/signup";

export const RESET_TOKEN_MINUTES = 60;
export const RESET_PASSWORD_MIN = 8;

export function createResetToken(now = new Date(), bytes: () => Buffer = () => randomBytes(32)): NewToken {
  const token = bytes().toString("base64url");
  return { token, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + RESET_TOKEN_MINUTES * 60_000) };
}

/** Ο σύνδεσμος του email: <origin>/reset-password?token=… */
export function resetUrl(origin: string, token: string, lang: SignupLang): string {
  return `${origin.replace(/\/+$/, "")}/reset-password?token=${encodeURIComponent(token)}${lang === "en" ? "&lang=en" : ""}`;
}

export const forgotSchema = z.object({
  email: z.string().max(200).transform(normalizeEmail).pipe(z.string().email()),
  lang: z.enum(["el", "en"]).optional().default("el"),
});

export const resetSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/),
  password: z.string().min(RESET_PASSWORD_MIN).max(200),
  lang: z.enum(["el", "en"]).optional().default("el"),
});

type Msg = Record<SignupLang, string>;

export const RESET_MESSAGES = {
  /** ΙΔΙΟ μήνυμα πάντα — δεν λέει αν υπάρχει λογαριασμός. */
  neutral: {
    el: "Αν υπάρχει λογαριασμός με αυτό το email, σας στείλαμε σύνδεσμο για νέο κωδικό. Ισχύει 60 λεπτά.",
    en: "If an account exists for this email, we have sent a link to set a new password. It is valid for 60 minutes.",
  },
  invalidEmail: { el: "Γράψτε ένα έγκυρο email.", en: "Enter a valid email address." },
  rateLimit: { el: "Πολλές προσπάθειες. Δοκιμάστε ξανά σε λίγο.", en: "Too many attempts. Please try again later." },
  /** ΙΔΙΟ για άκυρο, ληγμένο, χρησιμοποιημένο token και ανενεργό χρήστη. */
  badLink: {
    el: "Ο σύνδεσμος δεν ισχύει ή έχει λήξει. Ζητήστε νέο.",
    en: "This link is invalid or has expired. Please request a new one.",
  },
  weak: { el: "Ο κωδικός θέλει τουλάχιστον 8 χαρακτήρες.", en: "The password needs at least 8 characters." },
  done: { el: "Ο κωδικός άλλαξε. Συνδεθείτε με τον νέο κωδικό.", en: "Your password was changed. Sign in with the new password." },
} satisfies Record<string, Msg>;

/** Το email με τον σύνδεσμο. Κανένα στοιχείο του λογαριασμού πέρα από το όνομα. */
export function resetEmail(lang: SignupLang, to: string, name: string, url: string): SignupEmail {
  const el = lang === "el";
  const lines = el
    ? [
        `Γεια σας ${name},`,
        "Λάβαμε αίτημα για νέο κωδικό στον λογαριασμό σας στο Kratisi.",
        `Ο σύνδεσμος ισχύει ${RESET_TOKEN_MINUTES} λεπτά και χρησιμοποιείται μία φορά. Αν δεν το ζητήσατε εσείς, αγνοήστε αυτό το μήνυμα — ο κωδικός σας δεν αλλάζει.`,
      ]
    : [
        `Hello ${name},`,
        "We received a request to set a new password for your Kratisi account.",
        `The link is valid for ${RESET_TOKEN_MINUTES} minutes and can be used once. If you did not request this, you can ignore this message — your password stays the same.`,
      ];
  return {
    to,
    subject: el ? "Νέος κωδικός — Kratisi" : "Reset your password — Kratisi",
    text: `${lines.join("\n\n")}\n\n${url}\n\nKratisi`,
    html: wrap(lines, { href: url, label: el ? "Ορισμός νέου κωδικού" : "Set a new password" }),
  };
}

/** Ποιος παίρνει σύνδεσμο: ενεργός, με επαληθευμένο email, και (αν έχει εταιρία) όχι σε αναστολή/ακυρωμένη. */
export function canReceiveReset(u: { isActive: boolean; emailVerifiedAt: Date | null; tenant: { status: string } | null } | null): boolean {
  if (!u || !u.isActive || u.emailVerifiedAt === null) return false;
  return !(u.tenant && (u.tenant.status === "SUSPENDED" || u.tenant.status === "CANCELLED"));
}
