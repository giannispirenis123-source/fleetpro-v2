// src/lib/vehicles.ts
// Κοινό σημείο για τους τύπους του οχήματος: το χρησιμοποιούν και τα API routes
// και η σελίδα του στόλου, ώστε το σχήμα των δεδομένων να μην αποκλίνει.

import type { Vehicle } from "@prisma/client";

export const VEHICLE_STATUSES = [
  "AVAILABLE",
  "RENTED",
  "MAINTENANCE",
  "INACTIVE",
] as const;

export const VEHICLE_CATEGORIES = [
  "A",
  "B",
  "C",
  "SUV",
  "PREMIUM",
  "LUXURY",
  "VAN",
  "MOTORCYCLE",
] as const;

export const FUEL_TYPES = [
  "PETROL",
  "DIESEL",
  "HYBRID",
  "ELECTRIC",
  "LPG",
] as const;

export type VehicleStatusValue = (typeof VEHICLE_STATUSES)[number];
export type VehicleCategoryValue = (typeof VEHICLE_CATEGORIES)[number];
export type FuelTypeValue = (typeof FUEL_TYPES)[number];

/** Χρώμα του pill ανά κατάσταση — οι κλάσεις υπάρχουν ήδη στο dashboard.css. */
export const VEHICLE_STATUS_CLASS: Record<string, string> = {
  AVAILABLE: "ok",
  RENTED: "info",
  MAINTENANCE: "warn",
  INACTIVE: "muted",
};

/**
 * Το σχήμα που ταξιδεύει από τον server στον client και επιστρέφει από το API.
 * Τα Decimal γίνονται number και οι ημερομηνίες "YYYY-MM-DD", ώστε να μπαίνουν
 * κατευθείαν σε <input type="date"> χωρίς μετατροπές στο UI.
 */
export interface VehicleDTO {
  id: string;
  brand: string;
  model: string;
  plate: string;
  year: number;
  color: string | null;
  category: string;
  dailyRate: number;
  status: string;
  km: number;
  fuel: string;
  seats: number;
  doors: number;
  transmission: string;
  ac: boolean;
  nextServiceKm: number | null;
  nextServiceDate: string | null;
  insuranceExpiry: string | null;
  kteoExpiry: string | null;
  notes: string | null;
}

const toDateInput = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

export function toVehicleDTO(v: Vehicle): VehicleDTO {
  return {
    id: v.id,
    brand: v.brand,
    model: v.model,
    plate: v.plate,
    year: v.year,
    color: v.color,
    category: v.category,
    dailyRate: Number(v.dailyRate),
    status: v.status,
    km: v.km,
    fuel: v.fuel,
    seats: v.seats,
    doors: v.doors,
    transmission: v.transmission,
    ac: v.ac,
    nextServiceKm: v.nextServiceKm,
    nextServiceDate: toDateInput(v.nextServiceDate),
    insuranceExpiry: toDateInput(v.insuranceExpiry),
    kteoExpiry: toDateInput(v.kteoExpiry),
    notes: v.notes,
  };
}

/** Πόσες ημέρες μένουν μέχρι την ημερομηνία· null αν δεν έχει οριστεί. */
export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(date + "T00:00:00.000Z").getTime();
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  return Math.round((target - todayUtc) / 86400000);
}

/** Ίδια όρια με τις ειδοποιήσεις του dashboard: service 30 ημέρες, τα άλλα 60. */
export const SERVICE_WARN_DAYS = 30;
export const EXPIRY_WARN_DAYS = 60;
