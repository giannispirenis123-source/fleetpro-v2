// src/lib/calendar.ts
// Ημερολόγιο — ημερομηνίες ως ΚΕΙΜΕΝΟ "YYYY-MM-DD", παντού.
//
// Οι κρατήσεις αποθηκεύουν ημερομηνία χωρίς ζώνη ώρας. Αν τις περνούσαμε
// από τοπικό Date, μια κράτηση της 1ης θα εμφανιζόταν στις 31 του
// προηγούμενου μήνα για όποιον βρίσκεται δυτικά. Με σύγκριση κειμένου
// (που για αυτή τη μορφή είναι και χρονολογική) δεν γίνεται ποτέ.
//
// Δεν εισάγει Prisma ή db: το ίδιο αρχείο τρέχει σε server και client.

/** "2026-09" — ο μήνας που δείχνει η σελίδα. */
export type MonthKey = string;

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** Ο τρέχων μήνας σε UTC — ίδιος για server και client. */
export function currentMonth(now: Date = new Date()): MonthKey {
  return now.toISOString().slice(0, 7);
}

/** Δέχεται μόνο σωστή μορφή· οτιδήποτε άλλο πέφτει στον τρέχοντα μήνα. */
export function normalizeMonth(value: unknown): MonthKey {
  return typeof value === "string" && MONTH_RE.test(value)
    ? value
    : currentMonth();
}

/** Μετακίνηση κατά μήνες, με σωστό γύρισμα χρονιάς. */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split("-").map(Number);
  const zero = y * 12 + (m - 1) + delta;
  return `${Math.floor(zero / 12)}-${pad((zero % 12) + 1)}`;
}

export function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const firstDay = (month: MonthKey): string => `${month}-01`;
export const lastDay = (month: MonthKey): string =>
  `${month}-${pad(daysInMonth(month))}`;

/** Όλες οι ημέρες του μήνα, σε σειρά. */
export function monthDays(month: MonthKey): string[] {
  const total = daysInMonth(month);
  return Array.from({ length: total }, (_, i) => `${month}-${pad(i + 1)}`);
}

/** 0 = Δευτέρα … 6 = Κυριακή — η ελληνική/ευρωπαϊκή εβδομάδα. */
export function weekdayIndex(day: string): number {
  const js = new Date(`${day}T00:00:00.000Z`).getUTCDay(); // 0 = Κυριακή
  return (js + 6) % 7;
}

/**
 * Το πλέγμα του μήνα: εβδομάδες × 7 ημέρες, γεμάτες και στις άκρες με τις
 * ημέρες των γειτονικών μηνών ώστε να μην υπάρχουν κενά κελιά.
 */
export interface GridDay {
  day: string;
  /** false για τις ημέρες του προηγούμενου/επόμενου μήνα. */
  inMonth: boolean;
}

export function monthGrid(month: MonthKey): GridDay[][] {
  const days = monthDays(month);
  const lead = weekdayIndex(days[0]);

  const before: GridDay[] = [];
  for (let i = lead; i > 0; i--) {
    before.push({ day: addDays(days[0], -i), inMonth: false });
  }

  const cells: GridDay[] = [
    ...before,
    ...days.map((day) => ({ day, inMonth: true })),
  ];

  // Συμπλήρωση μέχρι να κλείσει η τελευταία εβδομάδα.
  const last = days[days.length - 1];
  let extra = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ day: addDays(last, extra++), inMonth: false });
  }

  const weeks: GridDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Ημερομηνία ± ημέρες, πάντα σε UTC. */
export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Η σημερινή ημέρα σε UTC — για την ένδειξη «σήμερα». */
export const todayKey = (now: Date = new Date()): string =>
  now.toISOString().slice(0, 10);

/* ─────────────────────────────────────────────
   Κρατήσεις πάνω στο ημερολόγιο
   ───────────────────────────────────────────── */

/** Το ελάχιστο που χρειάζεται το ημερολόγιο από μια κράτηση. */
export interface CalendarSpan {
  pickupDate: string;
  returnDate: string;
}

/** Η κράτηση «πιάνει» την ημέρα όταν παραλαβή ≤ ημέρα ≤ επιστροφή. */
export function coversDay(b: CalendarSpan, day: string): boolean {
  return b.pickupDate <= day && day <= b.returnDate;
}

/**
 * Πού πέφτει η κράτηση μέσα στο ορατό εύρος, σε δείκτες ημερών.
 *
 * Μια κράτηση που ξεκινά πριν ή τελειώνει μετά τον μήνα «κόβεται» στα
 * όρια — η μπάρα φαίνεται να συνεχίζει, χωρίς να βγαίνει εκτός πίνακα.
 */
export interface SpanPlacement {
  startIndex: number;
  /** Πλήθος ημερών μέσα στο εύρος· πάντα ≥ 1. */
  length: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export function placeInRange(
  b: CalendarSpan,
  days: string[]
): SpanPlacement | null {
  if (days.length === 0) return null;

  const from = days[0];
  const to = days[days.length - 1];
  if (b.returnDate < from || b.pickupDate > to) return null;

  const start = b.pickupDate < from ? from : b.pickupDate;
  const end = b.returnDate > to ? to : b.returnDate;

  const startIndex = days.indexOf(start);
  const endIndex = days.indexOf(end);
  if (startIndex < 0 || endIndex < 0) return null;

  return {
    startIndex,
    length: endIndex - startIndex + 1,
    continuesBefore: b.pickupDate < from,
    continuesAfter: b.returnDate > to,
  };
}

/** Ο μήνας με λέξεις, στη γλώσσα του χρήστη. */
export function monthLabel(month: MonthKey, locale: string): string {
  const intl = locale === "en" ? "en-GB" : "el-GR";
  return new Intl.DateTimeFormat(intl, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00.000Z`));
}
