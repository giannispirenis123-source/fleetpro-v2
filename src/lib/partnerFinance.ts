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

/* ─────────────────────────────────────────────
   Διάστημα αναφοράς: μήνας, συγκεκριμένες ημέρες ή όλοι οι μήνες
   ───────────────────────────────────────────── */

/** Μέγιστο διάστημα «Συγκεκριμένες ημέρες» (και οι δύο ημέρες μετρούν). */
export const MAX_PERIOD_DAYS = 366;

export type Period =
  | { kind: "all" }
  | { kind: "month"; month: string; from: string; to: string }
  | { kind: "days"; from: string; to: string };

export const PERIOD_MESSAGES = {
  invalid: { el: "Μη έγκυρη ημερομηνία (YYYY-MM-DD).", en: "Invalid date (YYYY-MM-DD)." },
  month: { el: "Μη έγκυρος μήνας (YYYY-MM).", en: "Invalid month (YYYY-MM)." },
  order: { el: "Το «Από» δεν μπορεί να είναι μετά το «Έως».", en: "“From” cannot be after “To”." },
  tooLong: {
    el: `Το διάστημα δεν μπορεί να ξεπερνά τις ${MAX_PERIOD_DAYS} ημέρες.`,
    en: `The period cannot be longer than ${MAX_PERIOD_DAYS} days.`,
  },
} as const;

export type PeriodError = keyof typeof PERIOD_MESSAGES;

/** "YYYY-MM-DD" που υπάρχει πραγματικά στο ημερολόγιο (όχι 2026-02-30) → Date UTC, αλλιώς null. */
export function isoDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  const y = d.getUTCFullYear();
  return y >= 2000 && y <= 2100 ? d : null;
}

const DAY_MS = 86_400_000;

/**
 * Από τα φίλτρα της σελίδας: `from`+`to` (ημέρες) έχουν προτεραιότητα, μετά
 * `month`, αλλιώς «όλοι οι μήνες». Οι ημέρες είναι ΗΜΕΡΟΛΟΓΙΑΚΕΣ (Europe/Athens):
 * η ημερομηνία παραλαβής αποθηκεύεται ως σκέτη ημέρα, όπως και στο φίλτρο μήνα.
 */
export function parsePeriod(q: { month?: string | null; from?: string | null; to?: string | null }):
  | { ok: true; period: Period }
  | { ok: false; error: PeriodError } {
  if (q.from || q.to) {
    const from = isoDay(q.from);
    const to = isoDay(q.to);
    if (!from || !to) return { ok: false, error: "invalid" };
    if (from.getTime() > to.getTime()) return { ok: false, error: "order" };
    if ((to.getTime() - from.getTime()) / DAY_MS + 1 > MAX_PERIOD_DAYS) return { ok: false, error: "tooLong" };
    return { ok: true, period: { kind: "days", from: q.from!, to: q.to! } };
  }
  if (q.month) {
    const r = monthRange(q.month);
    if (!r) return { ok: false, error: "month" };
    const last = new Date(r.to.getTime() - DAY_MS).toISOString().slice(0, 10);
    return { ok: true, period: { kind: "month", month: q.month, from: `${q.month}-01`, to: last } };
  }
  return { ok: true, period: { kind: "all" } };
}

/** Το διάστημα για το ερώτημα: [πρώτη ημέρα, ημέρα μετά την τελευταία) — και οι δύο άκρες μετρούν. */
export function periodRange(p: Period): { from: Date; to: Date } | null {
  if (p.kind === "all") return null;
  const from = isoDay(p.from)!;
  const to = new Date(isoDay(p.to)!.getTime() + DAY_MS);
  return { from, to };
}

/** Για το όνομα αρχείου / την κεφαλίδα: «2026-11-01_2026-11-30» ή «ola». */
export const periodSlug = (p: Period): string => (p.kind === "all" ? "ola" : `${p.from}_${p.to}`);
