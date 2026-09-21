// src/lib/bookings.ts
// Κρατήσεις — κοινό σημείο για API και σελίδα.

import type { Booking, Customer, Vehicle } from "@prisma/client";

export const BOOKING_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
] as const;

export type BookingStatusValue = (typeof BOOKING_STATUSES)[number];

/** Χρώμα pill ανά κατάσταση — ίδια χαρτογράφηση με τον Πίνακα. */
export const BOOKING_STATUS_CLASS: Record<string, string> = {
  PENDING: "warn",
  CONFIRMED: "info",
  ACTIVE: "ok",
  COMPLETED: "muted",
  CANCELLED: "bad",
};

/**
 * Καταστάσεις στις οποίες το όχημα θεωρείται δεσμευμένο.
 * Σε λειτουργία REQUEST μια νέα εγγραφή μπαίνει PENDING, άρα δεν δεσμεύει·
 * δεσμεύει μόλις περάσει σε CONFIRMED.
 */
export const RESERVING_STATUSES: readonly string[] = ["CONFIRMED", "ACTIVE"];

/** Επιτρεπτές μεταβάσεις κατάστασης. Τελικές: COMPLETED, CANCELLED. */
export const STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export interface BookingDTO {
  id: string;
  bookingNumber: string;
  status: string;
  customerId: string;
  customerName: string;
  vehicleId: string;
  vehicleName: string;
  vehiclePlate: string;
  pickupDate: string;
  returnDate: string;
  totalDays: number;
  dailyRate: number;
  total: number;
  notes: string | null;
  createdAt: string;
}

type BookingWithRelations = Booking & {
  vehicle: Pick<Vehicle, "brand" | "model" | "plate">;
  customer: Pick<Customer, "firstName" | "lastName">;
};

const toDateInput = (d: Date): string => d.toISOString().slice(0, 10);

export function toBookingDTO(b: BookingWithRelations): BookingDTO {
  return {
    id: b.id,
    bookingNumber: b.bookingNumber,
    status: b.status,
    customerId: b.customerId,
    customerName: `${b.customer.firstName} ${b.customer.lastName}`,
    vehicleId: b.vehicleId,
    vehicleName: `${b.vehicle.brand} ${b.vehicle.model}`,
    vehiclePlate: b.vehicle.plate,
    pickupDate: toDateInput(b.pickupDate),
    returnDate: toDateInput(b.returnDate),
    totalDays: b.totalDays,
    dailyRate: Number(b.dailyRate),
    total: Number(b.total),
    notes: b.notes,
    createdAt: b.createdAt.toISOString(),
  };
}

/** Πλήθος ημερών· τουλάχιστον 1 ακόμη κι αν οι ημερομηνίες συμπίπτουν. */
export function countDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00.000Z`).getTime();
  const b = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86400000));
}
