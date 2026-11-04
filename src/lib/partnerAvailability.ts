// src/lib/partnerAvailability.ts
// Διαθεσιμότητα για τον συνεργάτη — ΚΑΘΑΡΗ λογική πάνω στον ΙΔΙΟ κανόνα
// δέσμευσης με site/dashboard (vehicleClaims: PENDING/CONFIRMED/ACTIVE, όχι
// ληγμένη αναμονή πληρωμής, καθυστερήσεις, αλλαγές οχήματος).
//
// Βγάζει ΜΟΝΟ «ελεύθερο/κατειλημμένο» ανά όχημα και ημέρα: κανένα όνομα
// πελάτη, αριθμός ή ώρα άλλης κράτησης δεν φεύγει από τον server.

import {
  OUT_OF_SERVICE,
  intervalsConflict,
  vehicleClaims,
  wallClockMs,
  type BlockingBooking,
} from "./public/availability";

export const MAX_AVAILABILITY_DAYS = 31;

export interface AvailabilityVehicle {
  id: string;
  tenantId: string;
  label: string;
  status: string;
  isActive: boolean;
}

export interface AvailabilityRow {
  id: string;
  label: string;
  /** true = ελεύθερο όλη την ημέρα· false = κατειλημμένο (κράτηση ή εκτός λειτουργίας). */
  free: boolean[];
}

/** "YYYY-MM-DD" + n ημέρες → λίστα ημερών (χωρίς ζώνη ώρας). */
export function dayList(from: string, days: number): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  if (!m) return [];
  const n = Math.max(1, Math.min(MAX_AVAILABILITY_DAYS, Math.floor(days)));
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + i)).toISOString().slice(0, 10));
}

export function availabilityGrid(input: {
  companyId: string;
  vehicles: AvailabilityVehicle[];
  bookings: BlockingBooking[];
  days: string[];
  /** "YYYY-MM-DDTHH:mm" στη ζώνη της εταιρίας (καθυστερήσεις). */
  now?: string;
  instantMs?: number;
}): AvailabilityRow[] {
  const claims = vehicleClaims(input.bookings, input);
  return input.vehicles
    .filter((v) => v.tenantId === input.companyId)
    .map((v) => {
      const out = !v.isActive || (OUT_OF_SERVICE as readonly string[]).includes(v.status);
      const mine = claims.filter((c) => c.vehicleId === v.id);
      return {
        id: v.id,
        label: v.label,
        free: input.days.map((d) => {
          if (out) return false;
          const day = { start: wallClockMs(d, "00:00", "start"), end: wallClockMs(d, "23:59", "end") + 60_000 };
          return !mine.some((c) => intervalsConflict(day, c.interval));
        }),
      };
    });
}
