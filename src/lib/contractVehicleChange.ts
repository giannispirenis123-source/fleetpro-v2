// src/lib/contractVehicleChange.ts
// Αλλαγή οχήματος στο συμβόλαιο: το ΝΕΟ όχημα πρέπει να είναι ελεύθερο από
// την ημερομηνία της αλλαγής ως το τέλος της κράτησης (εκτός της ίδιας της
// κράτησης) — ΙΔΙΟΣ κανόνας με site/dashboard (src/lib/public/availability.ts),
// μέσα στο κλείδωμα της εταιρίας. Σύγκρουση → 409, τίποτα δεν αλλάζει.

import type { Prisma } from "@prisma/client";
import { vehicleConflictsInWindow, tenantNowLocal } from "./bookingConflicts";
import { bookingInterval, changeInterval, localMs, readVehicleChanges, type VehicleChange } from "./public/availability";
import type { BookingConflict } from "./bookings";

/** Μόνο οι αλλαγές που ΔΕΝ υπήρχαν ήδη (ίδιο όχημα + ίδια ημερομηνία) ελέγχονται. */
export function addedVehicleChanges(previous: unknown, next: VehicleChange[]): VehicleChange[] {
  const before = new Set(readVehicleChanges(previous).map((c) => `${c.vehicleId}|${c.date}`));
  return next.filter((c) => !before.has(`${c.vehicleId}|${c.date}`));
}

const dmy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

export function vehicleChangeConflictMessage(vehicle: string, date: string, conflicts: BookingConflict[]): string {
  const nums = Array.from(new Set(conflicts.map((c) => c.bookingNumber).filter(Boolean)));
  return (
    `Το όχημα ${vehicle} δεν είναι ελεύθερο από ${dmy(date)} ως την επιστροφή` +
    (nums.length ? `: συγκρούεται με την κράτηση ${nums.join(", ")}` : "") +
    ". Δεν αποθηκεύτηκε καμία αλλαγή."
  );
}

export class VehicleChangeConflictError extends Error {}

/**
 * Μέσα στην transaction ΜΕΤΑ το κλείδωμα της εταιρίας. `changes` = μόνο οι
 * νέες αλλαγές· `labels` = «Μάρκα Μοντέλο (πινακίδα)» ανά όχημα.
 */
export async function assertVehicleChangesFree(
  tx: Prisma.TransactionClient,
  opts: { tenantId: string; bookingId: string; changes: VehicleChange[]; labels: Map<string, string>; now?: Date }
): Promise<void> {
  if (opts.changes.length === 0) return;
  const now = opts.now ?? new Date();
  const [booking, tenant, nowL] = await Promise.all([
    tx.booking.findFirst({
      where: { id: opts.bookingId, tenantId: opts.tenantId },
      select: { status: true, pickupDate: true, pickupTime: true, returnDate: true, returnTime: true },
    }),
    tx.tenant.findUnique({ where: { id: opts.tenantId }, select: { prepTimeMinutes: true } }),
    tenantNowLocal(tx, opts.tenantId, now),
  ]);
  if (!booking) return;
  const own = bookingInterval(
    {
      tenantId: opts.tenantId,
      vehicleId: "",
      status: booking.status,
      pickupDate: booking.pickupDate.toISOString().slice(0, 10),
      pickupTime: booking.pickupTime,
      returnDate: booking.returnDate.toISOString().slice(0, 10),
      returnTime: booking.returnTime,
    },
    localMs(nowL)
  );
  for (const c of opts.changes) {
    const conflicts = await vehicleConflictsInWindow({
      client: tx,
      tenantId: opts.tenantId,
      vehicleId: c.vehicleId,
      excludeBookingId: opts.bookingId,
      window: changeInterval(c.date, own),
      prepMinutes: tenant?.prepTimeMinutes ?? 0,
      now,
    });
    if (conflicts.length > 0) {
      throw new VehicleChangeConflictError(vehicleChangeConflictMessage(opts.labels.get(c.vehicleId) ?? "", c.date, conflicts));
    }
  }
}
