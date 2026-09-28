// src/lib/serviceForm.ts
// Τα zod schemas και οι βοηθοί των διαδρομών service/damages.
//
// Ζουν εδώ και όχι μέσα στα route.ts: τα αρχεία διαδρομής του Next.js
// επιτρέπουν μόνο συγκεκριμένα exports (GET, POST, dynamic κ.λπ.) και
// οτιδήποτε άλλο ρίχνει το build.

import { z } from "zod";
import { db } from "./db";
import { SERVICE_TYPES, DAMAGE_STATUSES } from "./service";

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Μορφή ημερομηνίας: YYYY-MM-DD");

/** "" και null σημαίνουν και τα δύο «καθόλου». */
const optionalDate = z.union([isoDate, z.literal(""), z.null()]).optional();
const optionalText = z.union([z.string(), z.null()]).optional();
const optionalMoney = z.union([z.number().min(0), z.null()]).optional();
const optionalInt = z.union([z.number().int().min(0), z.null()]).optional();

export const serviceSchema = z.object({
  vehicleId: z.string().min(1, "Επίλεξε όχημα"),
  type: z.enum(SERVICE_TYPES),
  date: isoDate,
  cost: optionalMoney,
  shop: optionalText,
  km: optionalInt,
  notes: optionalText,
  nextServiceDate: optionalDate,
  nextServiceKm: optionalInt,
});

export const serviceUpdateSchema = serviceSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "Δεν δόθηκε καμία αλλαγή" }
);

export const damageSchema = z.object({
  vehicleId: z.string().min(1, "Επίλεξε όχημα"),
  /** Προαιρετική: μια ζημιά μπορεί να μην αφορά καμία κράτηση. */
  bookingId: optionalText,
  description: z.string().min(3, "Γράψε μια περιγραφή"),
  date: isoDate,
  repairCost: optionalMoney,
  status: z.enum(DAMAGE_STATUSES).optional(),
  notes: optionalText,
});

export const damageUpdateSchema = damageSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "Δεν δόθηκε καμία αλλαγή" }
);

export const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

export const toDateOrNull = (value: string | null | undefined) =>
  value ? toDate(value) : null;

export const trimOrNull = (value: string | null | undefined) =>
  value?.trim() || null;

/** Το όχημα πρέπει να ανήκει στην ίδια εταιρία. */
export async function vehicleBelongs(vehicleId: string, tenantId: string) {
  const vehicle = await db.vehicle.findFirst({
    where: { id: vehicleId, tenantId },
    select: { id: true },
  });
  return Boolean(vehicle);
}

/**
 * Η κράτηση πρέπει να ανήκει στην ίδια εταιρία ΚΑΙ στο ίδιο όχημα:
 * μια ζημιά δεν δένεται σε κράτηση άλλου αυτοκινήτου.
 */
export async function bookingMatches(
  bookingId: string,
  vehicleId: string,
  tenantId: string
) {
  const booking = await db.booking.findFirst({
    where: { id: bookingId, tenantId, vehicleId },
    select: { id: true },
  });
  return Boolean(booking);
}
