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
 * Βάση της προμήθειας είναι ΜΟΝΟ το ενοίκιο (subtotal).
 *
 * Δεν μπαίνουν πρόσθετα, ασφάλεια, έκπτωση ή στρογγυλοποίηση: ο
 * συνεργάτης αμείβεται για την ενοικίαση που έφερε, όχι για ό,τι
 * πουλήθηκε γύρω από αυτήν.
 */
export function commissionOf(subtotal: number, ratePercent: number): number {
  const rate = Math.max(0, ratePercent);
  return round2(Math.max(0, subtotal) * (rate / 100));
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

export interface CommissionLine {
  bookingId: string;
  bookingNumber: string;
  status: string;
  /** "YYYY-MM-DD" */
  pickupDate: string;
  subtotal: number;
  commission: number;
  counts: boolean;
}

export interface CommissionSummary {
  ratePercent: number;
  /** Πλήθος κρατήσεων που μετράνε. */
  bookings: number;
  subtotal: number;
  commission: number;
}

export function summarize(
  lines: CommissionLine[],
  ratePercent: number
): CommissionSummary {
  const counted = lines.filter((l) => l.counts);

  return {
    ratePercent,
    bookings: counted.length,
    subtotal: round2(counted.reduce((a, l) => a + l.subtotal, 0)),
    commission: round2(counted.reduce((a, l) => a + l.commission, 0)),
  };
}

/** Οι γραμμές ενός συγκεκριμένου μήνα ("YYYY-MM"). */
export const inMonth = (lines: CommissionLine[], month: string) =>
  lines.filter((l) => l.pickupDate.startsWith(month));
