// src/lib/signup/signup.ts
// Αυτόματη εγγραφή εταιρίας — καθαρή λογική (σχήμα, μηνύματα, email).
// Η ροή με τη βάση: signupServer.ts. Τα routes μόνο συνδέουν.
//
// ΑΣΦΑΛΕΙΑ:
// · Ποτέ δεν φανερώνεται αν ένα email υπάρχει: ΙΔΙΑ απάντηση για νέο,
//   υπάρχον και honeypot («Αν το email είναι διαθέσιμο, στείλαμε σύνδεσμο»).
// · Ο client δεν διαλέγει ρόλο, εταιρία, πακέτο ή κατάσταση: το σχήμα δεν έχει
//   καν τέτοια πεδία (zod .strip — ό,τι άλλο σταλεί αγνοείται).

import { z } from "zod";

/** Ίδιος κανόνας με όλους τους κωδικούς της εφαρμογής (users, Super Admin). */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
export const NAME_MAX = 120;

export type SignupLang = "el" | "en";
export const signupLang = (v: unknown): SignupLang => (v === "en" ? "en" : "el");

/** trim + πεζά — ΕΝΑ σημείο για εγγραφή, επαλήθευση και «ξαναστείλε». */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

const text = (max: number) => z.string().trim().min(2).max(max);

export const signupSchema = z.object({
  companyName: text(NAME_MAX),
  ownerName: text(NAME_MAX),
  email: z.string().trim().max(254).email().transform(normalizeEmail),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
  acceptTerms: z.literal(true),
  /** Honeypot: κρυφό πεδίο. Γεμάτο = bot → «επιτυχία» χωρίς τίποτα. */
  website: z.string().max(500).optional(),
  lang: z.enum(["el", "en"]).optional(),
  /** Κωδικός ιδρυτή (προαιρετικός) — ελέγχεται ΜΟΝΟ στον server (billing/founding.ts). */
  founderCode: z.string().max(40).optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const resendSchema = z.object({
  email: z.string().trim().max(254).email().transform(normalizeEmail),
  lang: z.enum(["el", "en"]).optional(),
});

export const verifySchema = z.object({ token: z.string().max(200) });

export const isHoneypotFilled = (v: string | undefined | null): boolean => typeof v === "string" && v.trim() !== "";

/** Η ΜΙΑ ουδέτερη απάντηση (νέο email, υπάρχον email, honeypot). */
export const SIGNUP_NEUTRAL: Record<SignupLang, string> = {
  el: "Αν το email είναι διαθέσιμο, στείλαμε σύνδεσμο επαλήθευσης. Δείτε τα εισερχόμενά σας (και τα ανεπιθύμητα).",
  en: "If the email is available, we sent a verification link. Check your inbox (and spam folder).",
};

export const RESEND_NEUTRAL: Record<SignupLang, string> = {
  el: "Αν υπάρχει λογαριασμός που περιμένει επαλήθευση με αυτό το email, στείλαμε νέο σύνδεσμο.",
  en: "If an account with this email is waiting for verification, we sent a new link.",
};

export const SIGNUP_ERRORS = {
  rateLimit: {
    el: "Πολλές προσπάθειες. Δοκιμάστε ξανά σε λίγο.",
    en: "Too many attempts. Please try again later.",
  },
  invalid: {
    el: "Ελέγξτε τα στοιχεία της φόρμας.",
    en: "Please check the form fields.",
  },
  verifyInvalid: {
    el: "Ο σύνδεσμος δεν είναι έγκυρος ή έχει ήδη χρησιμοποιηθεί.",
    en: "The link is invalid or has already been used.",
  },
  verifyExpired: {
    el: "Ο σύνδεσμος έληξε. Ζητήστε νέο παρακάτω.",
    en: "The link has expired. Request a new one below.",
  },
} as const;

/**
 * ΜΟΝΟ application/json: μια ξένη σελίδα δεν μπορεί να στείλει τέτοιο αίτημα
 * χωρίς CORS preflight (που δεν περνά). Κλείνει το «login CSRF» μέσω του
 * συνδέσμου επαλήθευσης και τις εγγραφές από φόρμες τρίτων.
 */
export const isJsonRequest = (req: Request): boolean =>
  (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() === "application/json";

/* ── Email ── */

export interface SignupEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function wrap(paragraphs: string[], link?: { href: string; label: string }): string {
  const ps = paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`).join("");
  const btn = link
    ? `<p style="margin:20px 0"><a href="${escapeHtml(link.href)}" style="background:#2563eb;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(link.label)}</a></p><p style="margin:0 0 14px;font-size:12px;color:#64748b;word-break:break-all">${escapeHtml(link.href)}</p>`
    : "";
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;max-width:520px">${ps}${btn}<p style="margin:24px 0 0;font-size:12px;color:#64748b">FleetPro</p></div>`;
}

/** «Επιβεβαιώστε το email σας» — ο σύνδεσμος ισχύει 24 ώρες, μία φορά. */
export function verificationEmail(lang: SignupLang, to: string, name: string, url: string): SignupEmail {
  const el = lang === "el";
  const hello = el ? `Γεια σας ${name},` : `Hello ${name},`;
  const lines = el
    ? [hello, "Για να ολοκληρωθεί η εγγραφή της εταιρίας σας στο FleetPro, επιβεβαιώστε το email σας.", "Ο σύνδεσμος ισχύει 24 ώρες και χρησιμοποιείται μία φορά. Αν δεν κάνατε εσείς την εγγραφή, αγνοήστε αυτό το μήνυμα."]
    : [hello, "To finish registering your company on FleetPro, please confirm your email address.", "The link is valid for 24 hours and can be used once. If you did not sign up, you can ignore this message."];
  const label = el ? "Επιβεβαίωση email" : "Confirm email";
  return {
    to,
    subject: el ? "Επιβεβαιώστε το email σας — FleetPro" : "Confirm your email — FleetPro",
    text: `${lines.join("\n\n")}\n\n${url}\n\nFleetPro`,
    html: wrap(lines, { href: url, label }),
  };
}

/** Ουδέτερο email σε ΥΠΑΡΧΟΥΣΑ διεύθυνση: δεν φτιάχνεται τίποτα. */
export function existingAccountEmail(lang: SignupLang, to: string, loginUrl: string): SignupEmail {
  const el = lang === "el";
  const lines = el
    ? ["Κάποιος προσπάθησε να εγγραφεί στο FleetPro με αυτή τη διεύθυνση email, αλλά υπάρχει ήδη λογαριασμός.", "Αν ήσασταν εσείς, συνδεθείτε με τον υπάρχοντα λογαριασμό σας. Αν όχι, δεν χρειάζεται να κάνετε τίποτα — δεν άλλαξε τίποτα στον λογαριασμό σας."]
    : ["Someone tried to sign up for FleetPro with this email address, but an account already exists.", "If this was you, sign in with your existing account. If not, you don't need to do anything — nothing changed on your account."];
  return {
    to,
    subject: el ? "Προσπάθεια εγγραφής με το email σας — FleetPro" : "Sign-up attempt with your email — FleetPro",
    text: `${lines.join("\n\n")}\n\n${loginUrl}\n\nFleetPro`,
    html: wrap(lines, { href: loginUrl, label: el ? "Σύνδεση" : "Sign in" }),
  };
}
