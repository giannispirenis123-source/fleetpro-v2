// src/lib/cardNumber.ts
// Πλήρης αριθμός κάρτας — καθαρή λογική, χωρίς runtime imports (client,
// server, tests). Η κρυπτογράφηση ζει ΜΟΝΟ στον server (cardCrypto.ts).

/** Τα δύο σημεία της φόρμας με κάρτα. */
export const CARD_KINDS = ["payment", "deposit"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** Κενά και παύλες επιτρέπονται στην πληκτρολόγηση· αποθηκεύονται μόνο ψηφία. */
export const cardDigits = (input: string): string => input.replace(/[\s-]/g, "");

/** 13–19 ψηφία μετά τον καθαρισμό → τα ψηφία· αλλιώς null. */
export function normalizeCardNumber(input: string): string | null {
  const d = cardDigits(input);
  return /^\d{13,19}$/.test(d) ? d : null;
}

/** «•••• •••• •••• 1234» — ό,τι βλέπει ο Διαχειριστής πριν την «Εμφάνιση». */
export const maskedCardNumber = (last4: string): string => `•••• •••• •••• ${last4}`;

/** Ομαδοποίηση ανά 4 για ανάγνωση: «4111 1111 1111 1111». */
export const groupCardNumber = (digits: string): string => digits.replace(/(\d{4})(?=\d)/g, "$1 ");
