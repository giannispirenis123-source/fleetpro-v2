// src/lib/service.ts
// Service, ΚΤΕΟ και ζημιές — κοινό σημείο για API και σελίδα.
//
// Δεν εισάγει Prisma runtime ώστε να φορτώνεται και σε client component.

import type { ServiceRecord, Damage } from "@prisma/client";

/** Οι τύποι εγγραφής, όπως υπάρχουν ΗΔΗ στο enum της βάσης. */
export const SERVICE_TYPES = [
  "REGULAR",
  "KTEO",
  "TYRES",
  "BRAKES",
  "BATTERY",
  "REPAIR",
  "OTHER",
] as const;
export type ServiceTypeValue = (typeof SERVICE_TYPES)[number];

export const DAMAGE_STATUSES = ["PENDING", "RESOLVED"] as const;

/** Χρώμα pill ανά κατάσταση ζημιάς — κλάσεις που υπάρχουν στο dashboard.css. */
export const DAMAGE_STATUS_CLASS: Record<string, string> = {
  PENDING: "warn",
  RESOLVED: "ok",
};

/** Πόσες ημέρες πριν θεωρείται «επικείμενο» ένα service. */
export const SERVICE_SOON_DAYS = 30;

/* ─────────────────────────────────────────────
   Service
   ───────────────────────────────────────────── */

export interface ServiceRecordDTO {
  id: string;
  vehicleId: string;
  vehicleName: string;
  vehiclePlate: string;
  type: string;
  /** "YYYY-MM-DD" */
  date: string;
  km: number | null;
  cost: number | null;
  shop: string | null;
  /** Στη βάση λέγεται description. */
  notes: string | null;
  nextServiceDate: string | null;
  nextServiceKm: number | null;
  createdAt: string;
}

type WithVehicle = {
  vehicle: { brand: string; model: string; plate: string };
};

const dayOf = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

export function toServiceDTO(r: ServiceRecord & WithVehicle): ServiceRecordDTO {
  return {
    id: r.id,
    vehicleId: r.vehicleId,
    vehicleName: `${r.vehicle.brand} ${r.vehicle.model}`,
    vehiclePlate: r.vehicle.plate,
    type: r.type,
    date: dayOf(r.date)!,
    km: r.km,
    cost: r.cost === null ? null : Number(r.cost),
    shop: r.shop,
    notes: r.description,
    nextServiceDate: dayOf(r.nextServiceDate),
    nextServiceKm: r.nextServiceKm,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Πόσο κοντά είναι το επόμενο service.
 *
 * "overdue" — η ημερομηνία πέρασε
 * "soon"    — μέσα στις επόμενες SERVICE_SOON_DAYS ημέρες
 * null      — ούτε το ένα ούτε το άλλο, ή δεν έχει οριστεί
 */
export type DueState = "overdue" | "soon" | null;

export function dueState(
  nextServiceDate: string | null,
  today: string = new Date().toISOString().slice(0, 10)
): DueState {
  if (!nextServiceDate) return null;
  if (nextServiceDate < today) return "overdue";

  const limit = new Date(`${today}T00:00:00.000Z`);
  limit.setUTCDate(limit.getUTCDate() + SERVICE_SOON_DAYS);

  return nextServiceDate <= limit.toISOString().slice(0, 10) ? "soon" : null;
}

/* ─────────────────────────────────────────────
   Ζημιές
   ───────────────────────────────────────────── */

export interface DamageDTO {
  id: string;
  vehicleId: string;
  vehicleName: string;
  vehiclePlate: string;
  /** null όταν η ζημιά δεν αφορά συγκεκριμένη κράτηση. */
  bookingId: string | null;
  bookingNumber: string | null;
  description: string;
  date: string;
  repairCost: number | null;
  status: string;
  resolvedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export function toDamageDTO(
  d: Damage & WithVehicle & { booking: { bookingNumber: string } | null }
): DamageDTO {
  return {
    id: d.id,
    vehicleId: d.vehicleId,
    vehicleName: `${d.vehicle.brand} ${d.vehicle.model}`,
    vehiclePlate: d.vehicle.plate,
    bookingId: d.bookingId,
    bookingNumber: d.booking?.bookingNumber ?? null,
    description: d.description,
    date: dayOf(d.date)!,
    repairCost: d.repairCost === null ? null : Number(d.repairCost),
    status: d.status,
    resolvedAt: dayOf(d.resolvedAt),
    notes: d.notes,
    createdAt: d.createdAt.toISOString(),
  };
}

export const SERVICE_INCLUDE = {
  vehicle: { select: { brand: true, model: true, plate: true } },
} as const;

export const DAMAGE_INCLUDE = {
  vehicle: { select: { brand: true, model: true, plate: true } },
  booking: { select: { bookingNumber: true } },
} as const;
