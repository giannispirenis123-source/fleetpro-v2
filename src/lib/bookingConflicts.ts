// src/lib/bookingConflicts.ts
// Server-only: οι συγκρούσεις ενός οχήματος σε ένα διάστημα για το dashboard
// (νέα κράτηση, επεξεργασία, walk-in, αλλαγή οχήματος στο συμβόλαιο).
// Ζει χωριστά από το bookings.ts γιατί αυτό το τελευταίο το φορτώνουν και
// client components — δεν πρέπει να τραβά Prisma.
//
// ΙΔΙΟΣ κανόνας με το δημόσιο site: το ίδιο ερώτημα (loadBlockingBookings) και
// η ίδια κρίση (blockersOf) του src/lib/public/availability.ts — καταστάσεις,
// χρόνος προετοιμασίας, καθυστερήσεις, αλλαγές οχήματος, αναμονές πληρωμής.

import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { blockersOf, loadBlockingBookings, wallClockMs, type Interval, type VehicleClaim } from "./public/availability";
import { nowLocal } from "./public/search";
import { normalizeStorefrontSettings } from "./storefront/settings";
import type { BookingConflict } from "./bookings";

type Client = Prisma.TransactionClient | typeof db;

/** «Τώρα» στη ζώνη ώρας της εταιρίας (για τις καθυστερημένες επιστροφές). */
export async function tenantNowLocal(client: Client, tenantId: string, now = new Date()): Promise<string> {
  const t = await client.tenant.findUnique({ where: { id: tenantId }, select: { storefrontSettings: true } });
  return nowLocal(normalizeStorefrontSettings(t?.storefrontSettings).booking.timezone, now);
}

/** Δεσμεύσεις → BookingConflict (OVERLAP / PREP) για τα μηνύματα του dashboard. */
export function toConflicts(window: Interval, blockers: VehicleClaim[], prepMinutes: number): BookingConflict[] {
  const prep = Math.max(0, prepMinutes) * 60_000;
  return blockers
    .map((c) => ({
      bookingId: c.booking.id ?? "",
      bookingNumber: c.booking.bookingNumber ?? "",
      kind: (window.start < c.interval.end && window.end > c.interval.start ? "OVERLAP" : "PREP") as BookingConflict["kind"],
      returnAt: new Date(c.interval.end).toISOString(),
      readyAt: new Date(c.interval.end + prep).toISOString(),
    }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "OVERLAP" ? -1 : 1));
}

/**
 * Συγκρούσεις του `vehicleId` σε ένα διάστημα ώρας τοίχου. `window` = ms
 * (wallClockMs). Μέσα σε transaction με το κλείδωμα της εταιρίας όταν ακολουθεί εγγραφή.
 */
export async function vehicleConflictsInWindow(opts: {
  client?: Client;
  tenantId: string;
  vehicleId: string;
  excludeBookingId?: string;
  window: Interval;
  prepMinutes: number;
  now?: Date;
}): Promise<BookingConflict[]> {
  const client = opts.client ?? db;
  const now = opts.now ?? new Date();
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
  const [bookings, nowL] = await Promise.all([
    loadBlockingBookings(client, opts.tenantId, { from: iso(opts.window.start), to: iso(opts.window.end) }, now),
    tenantNowLocal(client, opts.tenantId, now),
  ]);
  const blockers = blockersOf(bookings, {
    companyId: opts.tenantId,
    vehicleId: opts.vehicleId,
    window: opts.window,
    prepMinutes: opts.prepMinutes,
    excludeBookingId: opts.excludeBookingId,
    now: nowL,
    instantMs: now.getTime(),
  });
  return toConflicts(opts.window, blockers, opts.prepMinutes);
}

export async function checkVehicleConflicts(opts: {
  /** Μέσα σε transaction (με το κλείδωμα της εταιρίας) — αλλιώς η κοινή σύνδεση. */
  client?: Prisma.TransactionClient;
  tenantId: string;
  vehicleId: string;
  /** Η ίδια η κράτηση που επεξεργαζόμαστε δεν συγκρούεται με τον εαυτό της. */
  excludeBookingId?: string;
  pickupDate: string;
  pickupTime: string | null;
  returnDate: string;
  returnTime: string | null;
  prepMinutes: number;
}): Promise<BookingConflict[]> {
  return vehicleConflictsInWindow({
    client: opts.client,
    tenantId: opts.tenantId,
    vehicleId: opts.vehicleId,
    excludeBookingId: opts.excludeBookingId,
    window: {
      start: wallClockMs(opts.pickupDate, opts.pickupTime, "start"),
      end: wallClockMs(opts.returnDate, opts.returnTime, "end"),
    },
    prepMinutes: opts.prepMinutes,
  });
}
