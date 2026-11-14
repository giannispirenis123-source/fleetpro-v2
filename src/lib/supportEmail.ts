// src/lib/supportEmail.ts
// Το email υποστήριξης της πλατφόρμας — ΜΟΝΟ από το env NEXT_PUBLIC_SUPPORT_EMAIL
// (καμία διεύθυνση σκληρογραμμένη στον κώδικα). Δημόσια πληροφορία (φαίνεται
// στη σελίδα σύνδεσης), γι' αυτό NEXT_PUBLIC_: η τιμή «ψήνεται» στο build, άρα
// αλλαγή της στο Vercel θέλει νέο deploy. Κενό ή άκυρο → null → ο σύνδεσμος
// «Επικοινωνήστε μαζί μας» δεν εμφανίζεται.

const EMAIL_RE = /^[^\s@<>"'`()]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Καθαρή διεύθυνση email ή null (ό,τι περάσει είναι ασφαλές για `mailto:`). */
export function parseSupportEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return v.length <= 160 && EMAIL_RE.test(v) ? v : null;
}

export const SUPPORT_EMAIL: string | null = parseSupportEmail(process.env.NEXT_PUBLIC_SUPPORT_EMAIL);
