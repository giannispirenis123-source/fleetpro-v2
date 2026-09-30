// src/lib/reportsQuery.ts
// Ερωτήματα και φίλτρα των Αναφορών.
//
// Ζουν εδώ και όχι μέσα στο route.ts: τα αρχεία διαδρομής του Next.js
// επιτρέπουν μόνο συγκεκριμένα exports (GET, POST, dynamic κ.λπ.).
//
// Server-only: εισάγει db.

import { db } from "./db";
import { buildReport, currentYear, yearBounds, type Report } from "./reports";

/** Αποδεκτά έτη — αρκετά ευρύ, αρκετά στενό ώστε να μη σκανάρει αιώνες. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** ?year=YYYY · χωρίς τιμή → το τρέχον έτος. */
export function parseYear(
  params: URLSearchParams
): { ok: true; year: number } | { ok: false; message: string } {
  const raw = params.get("year");
  if (!raw) return { ok: true, year: currentYear() };
  if (!/^\d{4}$/.test(raw)) return { ok: false, message: "Μορφή έτους: YYYY" };
  const year = Number(raw);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return { ok: false, message: "Μη έγκυρο έτος" };
  }
  return { ok: true, year };
}

/**
 * Τα έτη που έχει νόημα να διαλέξει ο χρήστης: από την πρώτη κράτηση ή το
 * πρώτο τιμολόγιο της εταιρίας ως το τρέχον έτος.
 */
export async function loadYears(tenantId: string): Promise<number[]> {
  const [firstBooking, firstInvoice] = await Promise.all([
    db.booking.findFirst({
      where: { tenantId },
      orderBy: { pickupDate: "asc" },
      select: { pickupDate: true },
    }),
    db.invoice.findFirst({
      where: { tenantId, paidAt: { not: null } },
      orderBy: { paidAt: "asc" },
      select: { paidAt: true },
    }),
  ]);

  const now = currentYear();
  const first = Math.max(
    MIN_YEAR,
    Math.min(
      now,
      firstBooking?.pickupDate.getUTCFullYear() ?? now,
      firstInvoice?.paidAt?.getUTCFullYear() ?? now
    )
  );
  const years: number[] = [];
  for (let y = now; y >= first; y--) years.push(y);
  return years;
}

/**
 * Η αναφορά ενός έτους. Όλα τα σύνολα υπολογίζονται από τη βάση, ΠΑΝΤΑ
 * με tenantId από το session.
 */
export async function loadReport(tenantId: string, year: number): Promise<Report> {
  const bounds = yearBounds(year);

  const [invoices, expenses, bookings, vehicles] = await Promise.all([
    db.invoice.findMany({
      where: { tenantId, status: "PAID", paidAt: bounds },
      select: { subtotal: true, paidAt: true, booking: { select: { vehicleId: true } } },
    }),
    db.expense.findMany({
      where: { tenantId, date: bounds },
      select: { date: true, amount: true },
    }),
    // Όσες επικαλύπτουν το έτος: παραλαβή πριν το τέλος, επιστροφή μετά την αρχή.
    db.booking.findMany({
      where: {
        tenantId,
        pickupDate: { lt: bounds.lt },
        returnDate: { gt: bounds.gte },
      },
      select: {
        vehicleId: true,
        status: true,
        pickupDate: true,
        returnDate: true,
        totalDays: true,
      },
    }),
    db.vehicle.findMany({
      where: { tenantId },
      select: {
        id: true,
        brand: true,
        model: true,
        plate: true,
        category: true,
        isActive: true,
      },
    }),
  ]);

  return buildReport({
    year,
    now: new Date(),
    invoices: invoices.map((i) => ({
      paidAt: i.paidAt!,
      net: Number(i.subtotal),
      vehicleId: i.booking.vehicleId,
    })),
    expenses: expenses.map((e) => ({ date: e.date, amount: Number(e.amount) })),
    bookings,
    vehicles: vehicles.map((v) => ({
      id: v.id,
      label: `${v.brand} ${v.model} · ${v.plate}`,
      category: v.category,
      isActive: v.isActive,
    })),
  });
}
