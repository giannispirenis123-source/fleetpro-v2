// src/lib/reports.ts
// Αναφορές — ετήσια εικόνα: έσοδα ανά μήνα, top οχήματα, κατηγορίες, KPIs.
//
// Δεν εισάγει Prisma runtime ώστε να φορτώνεται και σε client component.
//
// Ίδια λογική εσόδων με τα Οικονομικά: τιμολόγια ΕΞΟΦΛΗΜΕΝΑ μέσα στο
// διάστημα (paidAt), σε ΚΑΘΑΡΗ αξία (Invoice.subtotal, χωρίς ΦΠΑ). Όρια σε
// UTC, άνω όριο = αρχή της επόμενης ημέρας.

import { VEHICLE_CATEGORIES } from "./vehicles";

export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

const round2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");
const DAY_MS = 86_400_000;

/* ─────────────────────────────────────────────
   Διάστημα: ένα ημερολογιακό έτος
   ───────────────────────────────────────────── */

export const currentYear = (now: Date = new Date()) => now.getUTCFullYear();

/** [gte, lt) του έτους σε UTC. */
export function yearBounds(year: number): { gte: Date; lt: Date } {
  return {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

/** Οι 12 μήνες του έτους ως "YYYY-MM". */
export const yearMonths = (year: number): string[] =>
  Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);

/* ─────────────────────────────────────────────
   Σχήμα αναφοράς
   ───────────────────────────────────────────── */

export interface MonthRow {
  /** "YYYY-MM" */
  month: string;
  /** Καθαρά έσοδα (χωρίς ΦΠΑ) από τιμολόγια εξοφλημένα μέσα στον μήνα. */
  revenueNet: number;
  expenses: number;
  profit: number;
  /** Κρατήσεις (όχι ακυρωμένες) με παραλαβή μέσα στον μήνα. */
  bookings: number;
}

export interface VehicleRow {
  vehicleId: string;
  label: string;
  category: VehicleCategory;
  revenueNet: number;
  /** Κρατήσεις (όχι ακυρωμένες) με παραλαβή μέσα στο έτος. */
  bookings: number;
  /** Ημέρες ενοικίασης μέσα στο έτος (κομμένες στα όρια του έτους). */
  rentalDays: number;
}

export interface CategoryRow {
  category: VehicleCategory;
  revenueNet: number;
  /** Ποσοστό επί των καθαρών εσόδων του έτους, 0–100. */
  percent: number;
  /** Ενεργά οχήματα της κατηγορίας σήμερα. */
  vehicles: number;
  bookings: number;
}

export interface ReportKpis {
  revenueNet: number;
  expenses: number;
  profit: number;
  paidInvoices: number;
  /** Μέσο καθαρό έσοδο ανά εξοφλημένο τιμολόγιο. */
  avgInvoiceNet: number;
  bookings: number;
  cancelledBookings: number;
  rentalDays: number;
  /** Μέση διάρκεια ενοικίασης σε ημέρες. */
  avgRentalDays: number;
  activeVehicles: number;
  /**
   * Πληρότητα στόλου %: ημέρες ενοικίασης / (ενεργά οχήματα × ημέρες
   * περιόδου ως σήμερα). null για μελλοντικό έτος ή χωρίς στόλο.
   */
  utilization: number | null;
}

export interface Report {
  year: number;
  kpis: ReportKpis;
  months: MonthRow[];
  /** Τα 5 οχήματα με τα περισσότερα καθαρά έσοδα. */
  topVehicles: VehicleRow[];
  /** Όλες οι κατηγορίες με έσοδα ή οχήματα, από το μεγαλύτερο έσοδο. */
  categories: CategoryRow[];
}

/* ─────────────────────────────────────────────
   Υπολογισμός (καθαρή συνάρτηση — ο server μόνο)
   ───────────────────────────────────────────── */

export interface ReportInput {
  year: number;
  now: Date;
  invoices: { paidAt: Date; net: number; vehicleId: string }[];
  expenses: { date: Date; amount: number }[];
  /** Κρατήσεις που επικαλύπτουν το έτος — όλες οι καταστάσεις. */
  bookings: {
    vehicleId: string;
    status: string;
    pickupDate: Date;
    returnDate: Date;
    totalDays: number;
  }[];
  /** Όλα τα οχήματα της εταιρίας, και τα ανενεργά (για ετικέτες). */
  vehicles: {
    id: string;
    label: string;
    category: string;
    isActive: boolean;
  }[];
}

const isCategory = (c: string): c is VehicleCategory =>
  (VEHICLE_CATEGORIES as readonly string[]).includes(c);

/** Ημέρες ενοικίασης που πέφτουν μέσα στο [gte, lt). */
function overlapDays(
  pickup: Date,
  ret: Date,
  totalDays: number,
  gte: Date,
  lt: Date
): number {
  const start = Math.max(pickup.getTime(), gte.getTime());
  const end = Math.min(ret.getTime(), lt.getTime());
  if (end <= start) return 0;
  // Ολόκληρη μέσα → οι χρεωμένες ημέρες της κράτησης.
  if (start === pickup.getTime() && end === ret.getTime()) {
    return Math.max(totalDays, 1);
  }
  return Math.ceil((end - start) / DAY_MS);
}

export function buildReport(input: ReportInput): Report {
  const { year, now } = input;
  const { gte, lt } = yearBounds(year);
  const months = yearMonths(year);
  const monthIdx = (d: Date) =>
    d.getUTCFullYear() === year ? d.getUTCMonth() : -1;

  const vehicleById = new Map(input.vehicles.map((v) => [v.id, v]));

  /* ── Μήνες ── */
  const revenue = Array(12).fill(0) as number[];
  const expenses = Array(12).fill(0) as number[];
  const bookingsPerMonth = Array(12).fill(0) as number[];

  for (const inv of input.invoices) {
    const i = monthIdx(inv.paidAt);
    if (i >= 0) revenue[i] += inv.net;
  }
  for (const e of input.expenses) {
    const i = monthIdx(e.date);
    if (i >= 0) expenses[i] += e.amount;
  }

  /* ── Κρατήσεις ── */
  const live = input.bookings.filter((b) => b.status !== "CANCELLED");
  const cancelled = input.bookings.filter(
    (b) => b.status === "CANCELLED" && monthIdx(b.pickupDate) >= 0
  ).length;

  const perVehicle = new Map<string, { revenue: number; bookings: number; days: number }>();
  const touch = (id: string) => {
    let row = perVehicle.get(id);
    if (!row) {
      row = { revenue: 0, bookings: 0, days: 0 };
      perVehicle.set(id, row);
    }
    return row;
  };

  let bookingsCount = 0;
  let rentalDays = 0;
  let bookedDays = 0; // για τη μέση διάρκεια: οι χρεωμένες ημέρες

  for (const b of live) {
    const days = overlapDays(b.pickupDate, b.returnDate, b.totalDays, gte, lt);
    rentalDays += days;
    const row = touch(b.vehicleId);
    row.days += days;

    const i = monthIdx(b.pickupDate);
    if (i >= 0) {
      bookingsPerMonth[i] += 1;
      bookingsCount += 1;
      bookedDays += Math.max(b.totalDays, 1);
      row.bookings += 1;
    }
  }

  for (const inv of input.invoices) {
    if (monthIdx(inv.paidAt) >= 0) touch(inv.vehicleId).revenue += inv.net;
  }

  /* ── KPIs ── */
  const revenueNet = round2(revenue.reduce((s, n) => s + n, 0));
  const expensesTotal = round2(expenses.reduce((s, n) => s + n, 0));
  const paidInvoices = input.invoices.filter((i) => monthIdx(i.paidAt) >= 0).length;
  const activeVehicles = input.vehicles.filter((v) => v.isActive).length;

  // Πληρότητα: ως σήμερα για το τρέχον έτος, όλο το έτος για παλιότερο.
  const windowEnd = Math.min(lt.getTime(), now.getTime());
  const windowDays = Math.ceil((windowEnd - gte.getTime()) / DAY_MS);
  let utilization: number | null = null;
  if (windowDays > 0 && activeVehicles > 0) {
    const windowLt = new Date(gte.getTime() + windowDays * DAY_MS);
    const usedDays = live.reduce(
      (s, b) => s + overlapDays(b.pickupDate, b.returnDate, b.totalDays, gte, windowLt),
      0
    );
    utilization = Math.min(100, round2((usedDays / (activeVehicles * windowDays)) * 100));
  }

  const kpis: ReportKpis = {
    revenueNet,
    expenses: expensesTotal,
    profit: round2(revenueNet - expensesTotal),
    paidInvoices,
    avgInvoiceNet: paidInvoices > 0 ? round2(revenueNet / paidInvoices) : 0,
    bookings: bookingsCount,
    cancelledBookings: cancelled,
    rentalDays,
    avgRentalDays: bookingsCount > 0 ? round2(bookedDays / bookingsCount) : 0,
    activeVehicles,
    utilization,
  };

  /* ── Top οχήματα ── */
  const vehicleRows: VehicleRow[] = [...perVehicle.entries()].map(([id, r]) => {
    const v = vehicleById.get(id);
    return {
      vehicleId: id,
      label: v?.label ?? "—",
      category: v && isCategory(v.category) ? v.category : "B",
      revenueNet: round2(r.revenue),
      bookings: r.bookings,
      rentalDays: r.days,
    };
  });

  const topVehicles = vehicleRows
    .filter((v) => v.revenueNet > 0 || v.bookings > 0)
    .sort(
      (a, b) =>
        b.revenueNet - a.revenueNet ||
        b.rentalDays - a.rentalDays ||
        b.bookings - a.bookings
    )
    .slice(0, 5);

  /* ── Κατηγορίες ── */
  const byCategory = new Map<VehicleCategory, CategoryRow>(
    VEHICLE_CATEGORIES.map((c) => [
      c,
      { category: c, revenueNet: 0, percent: 0, vehicles: 0, bookings: 0 },
    ])
  );
  for (const v of input.vehicles) {
    if (v.isActive && isCategory(v.category)) byCategory.get(v.category)!.vehicles += 1;
  }
  for (const r of vehicleRows) {
    const c = byCategory.get(r.category)!;
    c.revenueNet += r.revenueNet;
    c.bookings += r.bookings;
  }

  const categories = [...byCategory.values()]
    .map((c) => ({
      ...c,
      revenueNet: round2(c.revenueNet),
      percent: revenueNet > 0 ? round2((c.revenueNet / revenueNet) * 100) : 0,
    }))
    .filter((c) => c.revenueNet > 0 || c.vehicles > 0 || c.bookings > 0)
    .sort((a, b) => b.revenueNet - a.revenueNet || b.vehicles - a.vehicles);

  return {
    year,
    kpis,
    months: months.map((month, i) => ({
      month,
      revenueNet: round2(revenue[i]),
      expenses: round2(expenses[i]),
      profit: round2(revenue[i] - expenses[i]),
      bookings: bookingsPerMonth[i],
    })),
    topVehicles,
    categories,
  };
}
