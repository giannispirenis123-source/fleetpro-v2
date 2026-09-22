// src/lib/bookingConflicts.ts
// Server-only: διαβάζει τις κρατήσεις ενός οχήματος και τις περνά στον
// υπολογισμό συγκρούσεων. Ζει χωριστά από το bookings.ts γιατί αυτό το
// τελευταίο το φορτώνουν και client components — δεν πρέπει να τραβά Prisma.

import { db } from "./db";
import {
  CONFLICT_STATUSES,
  findConflicts,
  type BookingConflict,
} from "./bookings";

export async function checkVehicleConflicts(opts: {
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
  const rows = await db.booking.findMany({
    where: {
      tenantId: opts.tenantId,
      vehicleId: opts.vehicleId,
      status: { in: CONFLICT_STATUSES as never[] },
      ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
    },
    select: {
      id: true,
      bookingNumber: true,
      pickupDate: true,
      pickupTime: true,
      returnDate: true,
      returnTime: true,
    },
  });

  return findConflicts(
    {
      pickupDate: opts.pickupDate,
      pickupTime: opts.pickupTime,
      returnDate: opts.returnDate,
      returnTime: opts.returnTime,
    },
    rows.map((r) => ({
      id: r.id,
      bookingNumber: r.bookingNumber,
      pickupDate: r.pickupDate.toISOString().slice(0, 10),
      pickupTime: r.pickupTime,
      returnDate: r.returnDate.toISOString().slice(0, 10),
      returnTime: r.returnTime,
    })),
    opts.prepMinutes
  );
}
