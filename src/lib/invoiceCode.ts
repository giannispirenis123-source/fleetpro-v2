// src/lib/invoiceCode.ts
// Ο κωδικός τιμολογίου που βλέπουν πελάτης και χρήστες (π.χ. K7M2-X9PQ) —
// ΟΛΗ η δημιουργία του ζει εδώ, ώστε να αλλάζει από ένα σημείο.
//
//  · 8 τυχαίοι χαρακτήρες σε μορφή XXXX-XXXX, χωρίς σειρά και χωρίς λογική
//    (δεν «προδίδει» πόσα τιμολόγια έχει βγάλει η εταιρία).
//  · Αλφάβητο 32 χαρακτήρων χωρίς O/0/I/1, που μπερδεύονται στο διάβασμα.
//  · crypto.randomInt: κρυπτογραφικά τυχαίο και χωρίς μεροληψία.
//  · Μοναδικός σε ΟΛΗ τη βάση (unique index στο invoices."invoiceCode").
//    Σε σύγκρουση (Prisma P2002) ξαναδοκιμάζουμε έως 5 φορές.
//  · Το ίδιο αλφάβητο χρησιμοποιεί το backfill του prisma/sql/19-invoice-pdf.sql.
//
// Ο παλιός αύξων αριθμός (INV-001) ΔΕΝ σβήνεται· απλώς δεν εμφανίζεται πια.
//
// Χωρίς runtime import του Prisma: το φορτώνουν και τα tests.

import { randomInt } from "node:crypto";

export const INVOICE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVOICE_CODE_LENGTH = 8;
export const INVOICE_CODE_MAX_ATTEMPTS = 5;

export const INVOICE_CODE_RE = new RegExp(
  `^[${INVOICE_CODE_ALPHABET}]{4}-[${INVOICE_CODE_ALPHABET}]{4}$`
);

export const isInvoiceCode = (s: unknown): s is string =>
  typeof s === "string" && INVOICE_CODE_RE.test(s);

/** Νέος τυχαίος κωδικός, π.χ. "K7M2-X9PQ". Το `rand` υπάρχει για τα tests. */
export function generateInvoiceCode(
  rand: (max: number) => number = randomInt
): string {
  let out = "";
  for (let i = 0; i < INVOICE_CODE_LENGTH; i++) {
    if (i === 4) out += "-";
    out += INVOICE_CODE_ALPHABET[rand(INVOICE_CODE_ALPHABET.length)];
  }
  return out;
}

/** Ήταν το σφάλμα σύγκρουση μοναδικότητας ΣΤΟΝ ΚΩΔΙΚΟ (P2002 στο invoiceCode); */
export function isInvoiceCodeConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;
  // Το target είναι λίστα πεδίων ή το όνομα του index — καλύπτουμε και τα δύο.
  return String(e.meta?.target ?? "").includes("invoiceCode");
}

/**
 * Τρέχει την εγγραφή με νέο κωδικό· αν «πέσει» σε ήδη υπάρχοντα κωδικό,
 * ξαναδοκιμάζει με καινούργιο, έως 5 φορές. Κάθε άλλο σφάλμα περνά προς τα
 * έξω όπως είναι.
 */
export async function withInvoiceCode<T>(
  write: (code: string) => Promise<T>,
  generate: () => string = generateInvoiceCode
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < INVOICE_CODE_MAX_ATTEMPTS; attempt++) {
    try {
      return await write(generate());
    } catch (error) {
      if (!isInvoiceCodeConflict(error)) throw error;
      last = error;
    }
  }
  throw last;
}
