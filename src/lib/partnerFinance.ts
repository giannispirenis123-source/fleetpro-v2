// src/lib/partnerFinance.ts
// «Οικονομικά» του συνεργάτη — ΚΑΘΑΡΗ λογική (server, client, tests).
//
// Η προμήθεια ΔΕΝ υπολογίζεται εδώ από την αρχή: είναι το commissionFor() του
// commission.ts (τρέχον ποσοστό + διακόπτες ενοίκιο/πρόσθετα/ασφάλεια, χωρίς
// έκπτωση). Το ποσό της κράτησης είναι το ΑΠΟΘΗΚΕΥΜΕΝΟ σύνολο
// (storedTotalCents — ποτέ ξαναϋπολογισμός).
//
// Στα σύνολα ΔΕΝ μετράνε: ακυρωμένες (countsForCommission) και κρατήσεις με
// πλήρη επιστροφή χρημάτων (paymentStatus REFUNDED). Μετράνε PENDING,
// CONFIRMED, ACTIVE, COMPLETED (και με μερική επιστροφή — PARTIALLY_REFUNDED).

import { commissionFor, countsForCommission, type CommissionParts, type CommissionSettings } from "./commission";

export const REFUNDED_PAYMENT = "REFUNDED";

/** Μετράει η κράτηση στα σύνολα («Σύνολο κρατήσεων» / «Καθαρή προμήθεια»); */
export const countsForPartnerTotals = (status: string, paymentStatus: string | null | undefined): boolean =>
  countsForCommission(status) && paymentStatus !== REFUNDED_PAYMENT;

export interface PartnerFinanceInput extends CommissionParts {
  id: string;
  bookingNumber: string;
  /** "YYYY-MM-DD" */
  pickupDate: string;
  returnDate: string;
  vehicle: string;
  status: string;
  paymentStatus: string;
  /** Το αποθηκευμένο σύνολο της κράτησης (cents). */
  totalCents: number;
}

export interface PartnerFinanceRow {
  id: string;
  bookingNumber: string;
  pickupDate: string;
  returnDate: string;
  vehicle: string;
  status: string;
  /** Πλήρης επιστροφή χρημάτων. */
  refunded: boolean;
  totalCents: number;
  commissionCents: number;
  /** false = ακυρωμένη/επιστραμμένη: φαίνεται, αλλά ΔΕΝ μετρά στα σύνολα. */
  counted: boolean;
}

export interface PartnerFinanceTotals {
  /** Πόσες κρατήσεις μετρήθηκαν. */
  bookings: number;
  /** «Σύνολο κρατήσεων» (cents). */
  totalCents: number;
  /** «Καθαρή προμήθεια» (cents). */
  commissionCents: number;
}

const toCents = (euros: number) => Math.round(euros * 100);

export function partnerFinance(
  rows: PartnerFinanceInput[],
  settings: CommissionSettings
): { items: PartnerFinanceRow[]; totals: PartnerFinanceTotals } {
  const items = rows.map((r) => {
    const counted = countsForPartnerTotals(r.status, r.paymentStatus);
    return {
      id: r.id,
      bookingNumber: r.bookingNumber,
      pickupDate: r.pickupDate,
      returnDate: r.returnDate,
      vehicle: r.vehicle,
      status: r.status,
      refunded: r.paymentStatus === REFUNDED_PAYMENT,
      totalCents: Math.round(r.totalCents),
      // Ακυρωμένη δεν φέρνει προμήθεια (ίδιος κανόνας με τη σύνοψη των κρατήσεων).
      commissionCents: counted ? toCents(commissionFor(r, settings)) : 0,
      counted,
    };
  });
  const counted = items.filter((i) => i.counted);
  return {
    items,
    totals: {
      bookings: counted.length,
      totalCents: counted.reduce((a, i) => a + i.totalCents, 0),
      commissionCents: counted.reduce((a, i) => a + i.commissionCents, 0),
    },
  };
}

/** "YYYY-MM" → [πρώτη μέρα, πρώτη μέρα του επόμενου) σε UTC, ή null αν είναι άκυρο. */
export function monthRange(month: unknown): { from: Date; to: Date } | null {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  if (y < 2000 || y > 2100) return null;
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}
