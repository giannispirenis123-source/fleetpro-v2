// src/lib/finance.ts
// Οικονομικά — έξοδα εταιρίας και σύνοψη έσοδα / έξοδα / κέρδος.
//
// Δεν εισάγει Prisma runtime ώστε να φορτώνεται και σε client component.
//
// Έσοδα = τιμολόγια ΕΞΟΦΛΗΜΕΝΑ μέσα στο διάστημα (paidAt), σε ΚΑΘΑΡΗ αξία
// (Invoice.subtotal, χωρίς ΦΠΑ). Το ΦΠΑ αποδίδεται στο κράτος· αν μετρούσε
// ως έσοδο, το κέρδος θα φούσκωνε κατά 24%.

import type { Expense } from "@prisma/client";

/**
 * Οι τύποι εξόδου. Η στήλη expenses.type είναι ελεύθερο κείμενο στη βάση·
 * ο περιορισμός γίνεται εδώ και στο zod. Τιμές με πεζά, όπως τις ορίζει
 * το σχόλιο του schema.
 */
export const EXPENSE_TYPES = [
  "insurance",
  "service",
  "fuel",
  "salary",
  "rent",
  "marketing",
  "other",
] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

/** Άγνωστη ή παλιά τιμή στη βάση → «other», ώστε να μη χάνεται από τα σύνολα. */
export function normalizeExpenseType(value: string): ExpenseType {
  const v = value.trim().toLowerCase();
  return (EXPENSE_TYPES as readonly string[]).includes(v)
    ? (v as ExpenseType)
    : "other";
}

export interface ExpenseDTO {
  id: string;
  type: ExpenseType;
  amount: number;
  /** "YYYY-MM-DD" */
  date: string;
  vehicleId: string | null;
  /** "Μάρκα Μοντέλο · Πινακίδα" ή null όταν δεν αφορά όχημα. */
  vehicleLabel: string | null;
  notes: string | null;
  createdAt: string;
}

type WithVehicle = {
  vehicle: { brand: string; model: string; plate: string } | null;
};

export const EXPENSE_INCLUDE = {
  vehicle: { select: { brand: true, model: true, plate: true } },
} as const;

export function toExpenseDTO(e: Expense & WithVehicle): ExpenseDTO {
  return {
    id: e.id,
    type: normalizeExpenseType(e.type),
    amount: Number(e.amount),
    date: e.date.toISOString().slice(0, 10),
    vehicleId: e.vehicleId,
    vehicleLabel: e.vehicle
      ? `${e.vehicle.brand} ${e.vehicle.model} · ${e.vehicle.plate}`
      : null,
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
  };
}

/* ─────────────────────────────────────────────
   Διάστημα
   ───────────────────────────────────────────── */

export interface DateRange {
  /** "YYYY-MM-DD", συμπεριλαμβάνεται */
  from: string;
  /** "YYYY-MM-DD", συμπεριλαμβάνεται */
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM" → πρώτη και τελευταία ημέρα του μήνα. */
export function monthRange(month: string): DateRange {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

/** Ο τρέχων μήνας ως "YYYY-MM". */
export function currentMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Τα όρια για ερώτημα σε στήλη timestamp: [gte, lt).
 * Το άνω όριο είναι η ΑΡΧΗ της επόμενης ημέρας — όχι τα μεσάνυχτα της
 * τελευταίας — ώστε ένα τιμολόγιο που εξοφλήθηκε στις 18:00 της τελευταίας
 * ημέρας να μετρά.
 */
export function rangeBounds(range: DateRange): { gte: Date; lt: Date } {
  const gte = new Date(`${range.from}T00:00:00.000Z`);
  const lt = new Date(`${range.to}T00:00:00.000Z`);
  lt.setUTCDate(lt.getUTCDate() + 1);
  return { gte, lt };
}

/* ─────────────────────────────────────────────
   Σύνοψη
   ───────────────────────────────────────────── */

export interface ExpenseBreakdownRow {
  type: ExpenseType;
  amount: number;
  /** Ποσοστό επί του συνόλου εξόδων, 0–100. */
  percent: number;
}

export interface FinanceSummary {
  range: DateRange;
  /** Καθαρά έσοδα (χωρίς ΦΠΑ) από εξοφλημένα τιμολόγια. */
  revenueNet: number;
  paidInvoices: number;
  expensesTotal: number;
  expensesCount: number;
  /** revenueNet − expensesTotal */
  profit: number;
  /** Όλοι οι τύποι, με σειρά από το μεγαλύτερο ποσό. */
  breakdown: ExpenseBreakdownRow[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Τα σύνολα υπολογίζονται ΜΟΝΟ εδώ, από τις γραμμές της βάσης. Ο client
 * δεν στέλνει ποτέ σύνολα.
 */
export function buildSummary(
  range: DateRange,
  invoiceNets: number[],
  expenses: { type: string; amount: number }[]
): FinanceSummary {
  const revenueNet = round2(invoiceNets.reduce((s, n) => s + n, 0));

  const byType = new Map<ExpenseType, number>(
    EXPENSE_TYPES.map((t) => [t, 0])
  );
  for (const e of expenses) {
    const t = normalizeExpenseType(e.type);
    byType.set(t, (byType.get(t) ?? 0) + e.amount);
  }

  const expensesTotal = round2(expenses.reduce((s, e) => s + e.amount, 0));

  const breakdown = EXPENSE_TYPES.map((type) => {
    const amount = round2(byType.get(type) ?? 0);
    return {
      type,
      amount,
      percent: expensesTotal > 0 ? round2((amount / expensesTotal) * 100) : 0,
    };
  }).sort((a, b) => b.amount - a.amount);

  return {
    range,
    revenueNet,
    paidInvoices: invoiceNets.length,
    expensesTotal,
    expensesCount: expenses.length,
    profit: round2(revenueNet - expensesTotal),
    breakdown,
  };
}
