// src/lib/emailSender.ts
// Ποιος στέλνει τα email μιας εταιρίας (συμβόλαιο, τιμολόγιο, απόφαση κράτησης)
// — καθαρή λογική, ΕΝΑ σημείο για όλη την εφαρμογή.
//
//  · Εταιρία με VERIFIED αποστολέα (SQL 33, χειροκίνητα από Admin μετά την
//    επαλήθευση του domain στο Resend) → «Όνομα <διεύθυνση>» της εταιρίας.
//  · Αλλιώς → το κοινό EMAIL_FROM, ακριβώς όπως πριν.
// Καμία κλήση στο Resend API. Το όνομα/η διεύθυνση καθαρίζονται ώστε να μη
// σπάσουν ποτέ το header From (CR/LF, <, >, ", κόμμα, ελεγκτικοί χαρακτήρες).

import { z } from "zod";

export const EMAIL_FROM_NAME_MAX = 80;
export const EMAIL_FROM_ADDRESS_MAX = 254;

const ADDRESS_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export interface TenantSender {
  emailFromName: string | null;
  emailFromAddress: string | null;
  emailSenderStatus: string | null;
}

/** Διεύθυνση αποστολής: πεζά, χωρίς κενά άκρων, ή null αν δεν είναι έγκυρη. */
export function normalizeSenderAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const a = raw.trim().toLowerCase();
  return a.length <= EMAIL_FROM_ADDRESS_MAX && ADDRESS_RE.test(a) ? a : null;
}

/** Όνομα εμφάνισης χωρίς χαρακτήρες που αλλάζουν το header (μόνο ένα απλό κείμενο). */
export function sanitizeSenderName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f<>"\\,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EMAIL_FROM_NAME_MAX);
}

/** Το domain της διεύθυνσης (για τις οδηγίες του Resend). */
export const senderDomain = (address: string | null): string | null => {
  const a = normalizeSenderAddress(address);
  return a ? a.slice(a.indexOf("@") + 1) : null;
};

/** "Όνομα" <διεύθυνση> — ή σκέτη διεύθυνση χωρίς όνομα. null αν η διεύθυνση δεν είναι έγκυρη. */
export function formatSender(name: unknown, address: unknown): string | null {
  const a = normalizeSenderAddress(address);
  if (!a) return null;
  const n = sanitizeSenderName(name);
  return n ? `"${n}" <${a}>` : a;
}

/**
 * Ο αποστολέας για ένα email της εταιρίας: ο δικός της ΜΟΝΟ αν είναι VERIFIED
 * και έγκυρος· αλλιώς το `fallback` (EMAIL_FROM) όπως σήμερα.
 */
export function chooseEmailFrom(tenant: TenantSender | null | undefined, fallback: string | undefined): string | undefined {
  if (tenant?.emailSenderStatus === "VERIFIED") {
    const own = formatSender(tenant.emailFromName, tenant.emailFromAddress);
    if (own) return own;
  }
  return fallback;
}

/** Ρυθμίσεις → «Αποστολέας email». Νέα διεύθυνση = UNVERIFIED ξανά (στον server). */
export const emailSenderSchema = z.object({
  name: z.string().max(EMAIL_FROM_NAME_MAX, "Το όνομα έως 80 χαρακτήρες"),
  address: z
    .string()
    .max(EMAIL_FROM_ADDRESS_MAX)
    .refine((v) => v.trim() === "" || normalizeSenderAddress(v) !== null, "Μη έγκυρη διεύθυνση email"),
  verified: z.boolean(),
});
export type EmailSenderInput = z.infer<typeof emailSenderSchema>;
