// src/lib/commission.ts
// Η προμήθεια του συνεργάτη.
//
// Υπολογίζεται ΠΑΝΤΑ από το τρέχον ποσοστό του συνεργάτη — δεν
// «παγώνει» πάνω στην κράτηση. Αν ο διαχειριστής αλλάξει το ποσοστό, τα
// σύνολα ενημερώνονται μόνα τους, χωρίς να πειραχτεί καμία κράτηση.
//
// Δεν εισάγει Prisma: φορτώνεται και σε client component.

import { round2 } from "./pricing";

/**
 * Οι ρυθμίσεις προμήθειας ενός χρήστη: το ποσοστό και οι τρεις
 * ΑΝΕΞΑΡΤΗΤΟΙ διακόπτες για το πάνω σε τι υπολογίζεται.
 */
export interface CommissionSettings {
  rate: number;
  onRental: boolean;
  onExtras: boolean;
  onInsurance: boolean;
}

export const NO_COMMISSION: CommissionSettings = {
  rate: 0,
  onRental: true,
  onExtras: false,
  onInsurance: false,
};

/** Τα καθαρά συστατικά μιας κράτησης, πριν από έκπτωση και στρογγυλοποίηση. */
export interface CommissionParts {
  subtotal: number;
  extrasTotal: number;
  insuranceCost: number;
}

/**
 * Πάνω σε τι υπολογίζεται η προμήθεια.
 *
 * Μπαίνουν ΜΟΝΟ όσα συστατικά έχουν ανοιχτό διακόπτη, και πάντα στην
 * καθαρή τους μορφή: χωρίς έκπτωση και χωρίς στρογγυλοποίηση. Δύο
 * υπάλληλοι με το ίδιο ποσοστό πρέπει να αμείβονται το ίδιο για την ίδια
 * ενοικίαση, ανεξάρτητα από το τι έκπτωση δόθηκε στον πελάτη.
 */
export function commissionBase(
  parts: CommissionParts,
  s: CommissionSettings
): number {
  const sum =
    (s.onRental ? Math.max(0, parts.subtotal) : 0) +
    (s.onExtras ? Math.max(0, parts.extrasTotal) : 0) +
    (s.onInsurance ? Math.max(0, parts.insuranceCost) : 0);

  return round2(sum);
}

/** Η προμήθεια μιας κράτησης για τις συγκεκριμένες ρυθμίσεις. */
export function commissionFor(
  parts: CommissionParts,
  s: CommissionSettings
): number {
  if (s.rate <= 0) return 0;
  return round2(commissionBase(parts, s) * (Math.max(0, s.rate) / 100));
}

/** Απλή εκδοχή, όταν η βάση είναι ήδη υπολογισμένη. */
export function commissionOf(base: number, ratePercent: number): number {
  const rate = Math.max(0, ratePercent);
  return round2(Math.max(0, base) * (rate / 100));
}

/** Σύντομη περιγραφή της βάσης, για το UI: «Ενοίκιο + Πρόσθετα». */
export function baseLabels(s: CommissionSettings): ("rental" | "extras" | "insurance")[] {
  const out: ("rental" | "extras" | "insurance")[] = [];
  if (s.onRental) out.push("rental");
  if (s.onExtras) out.push("extras");
  if (s.onInsurance) out.push("insurance");
  return out;
}

/**
 * Μια ακυρωμένη κράτηση δεν φέρνει προμήθεια.
 *
 * Όλες οι υπόλοιπες μετράνε — και οι εκκρεμείς. Ο συνεργάτης έφερε τη
 * δουλειά· το αν θα ολοκληρωθεί δεν εξαρτάται από εκείνον, και μια
 * σύνοψη που δείχνει μόνο τις ολοκληρωμένες θα ήταν άδεια όλη τη σεζόν.
 * Η ακύρωση είναι το μόνο σαφές «δεν έγινε».
 */
export const countsForCommission = (status: string): boolean =>
  status !== "CANCELLED";

export interface CommissionSummary {
  /** Πλήθος κρατήσεων που μετράνε. */
  bookings: number;
  base: number;
  commission: number;
}

/** Άθροισμα προμήθειας για μια λίστα κρατήσεων. */
export function summarize(
  bookings: (CommissionParts & { status: string })[],
  s: CommissionSettings
): CommissionSummary {
  const counted = bookings.filter((b) => countsForCommission(b.status));

  return {
    bookings: counted.length,
    base: round2(counted.reduce((a, b) => a + commissionBase(b, s), 0)),
    commission: round2(counted.reduce((a, b) => a + commissionFor(b, s), 0)),
  };
}
