// src/lib/financeForm.ts
// Zod schemas, φίλτρα και ερωτήματα των Οικονομικών.
//
// Ζουν εδώ και όχι μέσα στα route.ts: τα αρχεία διαδρομής του Next.js
// επιτρέπουν μόνο συγκεκριμένα exports (GET, POST, dynamic κ.λπ.).
//
// Server-only: εισάγει db.

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import {
  EXPENSE_TYPES,
  EXPENSE_INCLUDE,
  buildSummary,
  currentMonth,
  monthRange,
  rangeBounds,
  toExpenseDTO,
  type DateRange,
  type ExpenseDTO,
  type FinanceSummary,
} from "./finance";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Μορφή ημερομηνίας: YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Μη έγκυρη ημερομηνία");

const optionalText = z.union([z.string().max(1000), z.null()]).optional();

export const expenseSchema = z.object({
  type: z.enum(EXPENSE_TYPES, {
    errorMap: () => ({ message: "Μη έγκυρος τύπος εξόδου" }),
  }),
  amount: z
    .number()
    .positive("Το ποσό πρέπει να είναι μεγαλύτερο από 0")
    .max(10_000_000, "Πολύ μεγάλο ποσό"),
  date: isoDate,
  /** Προαιρετικό: ένα ενοίκιο γραφείου δεν αφορά κανένα όχημα. */
  vehicleId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  notes: optionalText,
});

export const expenseUpdateSchema = expenseSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "Δεν δόθηκε καμία αλλαγή" }
);

export const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

export const trimOrNull = (value: string | null | undefined) =>
  value?.trim() || null;

/** "" και null σημαίνουν «χωρίς όχημα». */
export const vehicleOrNull = (value: string | null | undefined) =>
  value ? value : null;

/** Το όχημα πρέπει να ανήκει στην ίδια εταιρία. */
export async function vehicleBelongs(vehicleId: string, tenantId: string) {
  const vehicle = await db.vehicle.findFirst({
    where: { id: vehicleId, tenantId },
    select: { id: true },
  });
  return Boolean(vehicle);
}

/* ─────────────────────────────────────────────
   Φίλτρα από το query string
   ───────────────────────────────────────────── */

/**
 * Διάστημα από ?month=YYYY-MM ή ?from=…&to=… (ημέρες, συμπεριλαμβάνονται).
 * Χωρίς τίποτα → ο τρέχων μήνας.
 */
export function parseRange(
  params: URLSearchParams
): { ok: true; range: DateRange } | { ok: false; message: string } {
  const month = params.get("month");
  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return { ok: false, message: "Μορφή μήνα: YYYY-MM" };
    }
    return { ok: true, range: monthRange(month) };
  }

  const from = params.get("from");
  const to = params.get("to");
  if (!from && !to) return { ok: true, range: monthRange(currentMonth()) };

  const f = isoDate.safeParse(from);
  const t = isoDate.safeParse(to);
  if (!f.success || !t.success) {
    return { ok: false, message: "Δώσε έγκυρο διάστημα από–έως" };
  }
  if (t.data < f.data) {
    return { ok: false, message: "Η λήξη δεν μπορεί να προηγείται της έναρξης" };
  }
  return { ok: true, range: { from: f.data, to: t.data } };
}

export interface ExpenseFilters {
  range: DateRange;
  type?: string | null;
  vehicleId?: string | null;
}

/** Το WHERE των εξόδων — ΠΑΝΤΑ με tenantId από το session. */
export function expenseWhere(
  tenantId: string,
  f: ExpenseFilters
): Prisma.ExpenseWhereInput {
  const known = EXPENSE_TYPES as readonly string[];
  const type = f.type && known.includes(f.type) ? f.type : null;

  return {
    tenantId,
    date: rangeBounds(f.range),
    ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
    ...(type === "other"
      ? // Το «Άλλο» μαζεύει και ό,τι άγνωστη τιμή υπάρχει στη βάση.
        { OR: [{ type: "other" }, { type: { notIn: [...known] } }] }
      : type
        ? { type }
        : {}),
  };
}

/* ─────────────────────────────────────────────
   Ερωτήματα (κοινά για σελίδα και API)
   ───────────────────────────────────────────── */

export async function loadExpenses(
  tenantId: string,
  f: ExpenseFilters
): Promise<ExpenseDTO[]> {
  const rows = await db.expense.findMany({
    where: expenseWhere(tenantId, f),
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: EXPENSE_INCLUDE,
    take: 1000,
  });
  return rows.map(toExpenseDTO);
}

/**
 * Σύνοψη διαστήματος. Υπολογίζεται πάντα από τη βάση:
 *  - έσοδα: τιμολόγια PAID με paidAt μέσα στο διάστημα, σε subtotal (καθαρό)
 *  - έξοδα: ΟΛΑ τα έξοδα του διαστήματος (χωρίς φίλτρο τύπου/οχήματος)
 */
export async function loadSummary(
  tenantId: string,
  range: DateRange
): Promise<FinanceSummary> {
  const bounds = rangeBounds(range);

  const [invoices, expenses] = await Promise.all([
    db.invoice.findMany({
      where: { tenantId, status: "PAID", paidAt: bounds },
      select: { subtotal: true },
    }),
    db.expense.findMany({
      where: { tenantId, date: bounds },
      select: { type: true, amount: true },
    }),
  ]);

  return buildSummary(
    range,
    invoices.map((i) => Number(i.subtotal)),
    expenses.map((e) => ({ type: e.type, amount: Number(e.amount) }))
  );
}
