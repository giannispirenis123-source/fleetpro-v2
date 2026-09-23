// src/lib/bookings.ts
// Κρατήσεις — κοινό σημείο για API και σελίδα.

import type { Booking, Customer, Vehicle } from "@prisma/client";
import { readExtrasSnapshot, type PricedExtraLine } from "./pricing";

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

/**
 * Καταστάσεις που λαμβάνονται υπόψη στον έλεγχο σύγκρουσης.
 * Ακυρωμένες και ολοκληρωμένες κρατήσεις δεν διεκδικούν πια το όχημα.
 * Οι εκκρεμείς μετρούν: σε λειτουργία αιτημάτων είναι η κανονική αρχική
 * κατάσταση, οπότε αλλιώς δεν θα προειδοποιούσε ποτέ τίποτα.
 */
export const CONFLICT_STATUSES: readonly string[] = [
  "PENDING",
  "CONFIRMED",
  "ACTIVE",
];

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
  /** "HH:mm" ή null σε παλιές κρατήσεις που καταχωρήθηκαν χωρίς ώρα. */
  pickupTime: string | null;
  returnDate: string;
  returnTime: string | null;
  totalDays: number;
  dailyRate: number;

  /* ── Ανάλυση τιμής ── */
  subtotal: number;
  extrasTotal: number;
  insuranceCost: number;
  discountAmount: number;
  discountCode: string | null;
  total: number;
  /** Τα πρόσθετα όπως ίσχυαν τη στιγμή της κράτησης (snapshot). */
  extras: PricedExtraLine[];

  notes: string | null;
  createdAt: string;

  /**
   * Ο αριθμός του τιμολογίου της κράτησης, αν έχει εκδοθεί — αλλιώς null.
   * Με αυτό ξέρει η λίστα αν πρέπει να δείξει το κουμπί έκδοσης ή τον
   * αριθμό του ήδη εκδομένου τιμολογίου.
   */
  invoiceNumber: string | null;
}

type BookingWithRelations = Booking & {
  vehicle: Pick<Vehicle, "brand" | "model" | "plate">;
  customer: Pick<Customer, "firstName" | "lastName">;
  /** Προαιρετικό: μόνο τα ερωτήματα που το χρειάζονται το φέρνουν. */
  invoice?: { invoiceNumber: string } | null;
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
    pickupTime: b.pickupTime,
    returnDate: toDateInput(b.returnDate),
    returnTime: b.returnTime,
    totalDays: b.totalDays,
    dailyRate: Number(b.dailyRate),
    subtotal: Number(b.subtotal),
    extrasTotal: Number(b.extrasTotal),
    insuranceCost: Number(b.insuranceCost),
    discountAmount: Number(b.discountAmount),
    discountCode: b.discountCode,
    total: Number(b.total),
    extras: readExtrasSnapshot(b.extras),
    notes: b.notes,
    createdAt: b.createdAt.toISOString(),
    invoiceNumber: b.invoice?.invoiceNumber ?? null,
  };
}

/** Πλήθος ημερών· τουλάχιστον 1 ακόμη κι αν οι ημερομηνίες συμπίπτουν. */
export function countDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00.000Z`).getTime();
  const b = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86400000));
}

/* ─────────────────────────────────────────────
   Ώρες, διαθεσιμότητα και συγκρούσεις
   ───────────────────────────────────────────── */

/** Μορφή ώρας που δέχονται και το API και η φόρμα. */
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Στιγμή σε ms από ημερομηνία "YYYY-MM-DD" + ώρα "HH:mm".
 *
 * Οι παλιές κρατήσεις δεν έχουν ώρες. Για να μην υποτιμάται η δέσμευση του
 * οχήματος, τις θεωρούμε ολοήμερες: παραλαβή στις 00:00, επιστροφή στις
 * 23:59. Έτσι ο έλεγχος σύγκρουσης είναι συντηρητικός αντί για αισιόδοξος.
 */
export function instantOf(
  date: string,
  time: string | null | undefined,
  fallback: "start" | "end"
): number {
  const t = time && TIME_RE.test(time) ? time : fallback === "start" ? "00:00" : "23:59";
  return new Date(`${date}T${t}:00.000Z`).getTime();
}

/** Πότε ελευθερώνεται πραγματικά το όχημα: επιστροφή + χρόνος προετοιμασίας. */
export function readyAt(
  returnDate: string,
  returnTime: string | null | undefined,
  prepMinutes: number
): number {
  return instantOf(returnDate, returnTime, "end") + Math.max(0, prepMinutes) * 60000;
}

export interface BookingWindow {
  id: string;
  bookingNumber: string;
  pickupDate: string;
  pickupTime: string | null;
  returnDate: string;
  returnTime: string | null;
}

/**
 * OVERLAP  — οι δύο ενοικιάσεις πέφτουν η μία πάνω στην άλλη.
 * PREP     — δεν πέφτουν, αλλά η μία ξεκινά μέσα στο κενό προετοιμασίας
 *            που αφήνει η άλλη.
 */
export type ConflictKind = "OVERLAP" | "PREP";

export interface BookingConflict {
  bookingId: string;
  bookingNumber: string;
  kind: ConflictKind;
  /** ISO — η ώρα επιστροφής της άλλης κράτησης. */
  returnAt: string;
  /** ISO — πότε το όχημα είναι ξανά έτοιμο (επιστροφή + προετοιμασία). */
  readyAt: string;
}

/**
 * Βρίσκει τις συγκρούσεις μιας υποψήφιας κράτησης με τις υπόλοιπες
 * κρατήσεις του ίδιου οχήματος.
 *
 * Ο έλεγχος είναι συμμετρικός: πιάνει και την περίπτωση που η υποψήφια
 * κράτηση αφήνει η ίδια πολύ λίγο χρόνο πριν από μια επόμενη.
 */
export function findConflicts(
  candidate: {
    pickupDate: string;
    pickupTime: string | null;
    returnDate: string;
    returnTime: string | null;
  },
  others: BookingWindow[],
  prepMinutes: number
): BookingConflict[] {
  const prep = Math.max(0, prepMinutes) * 60000;
  const start = instantOf(candidate.pickupDate, candidate.pickupTime, "start");
  const end = instantOf(candidate.returnDate, candidate.returnTime, "end");

  const conflicts: BookingConflict[] = [];

  for (const other of others) {
    const oStart = instantOf(other.pickupDate, other.pickupTime, "start");
    const oEnd = instantOf(other.returnDate, other.returnTime, "end");

    let kind: ConflictKind | null = null;

    if (start < oEnd && end > oStart) {
      kind = "OVERLAP";
    } else if (start >= oEnd && start < oEnd + prep) {
      // Η υποψήφια ξεκινά μέσα στο κενό προετοιμασίας της άλλης.
      kind = "PREP";
    } else if (oStart >= end && oStart < end + prep) {
      // Η άλλη ξεκινά μέσα στο κενό προετοιμασίας της υποψήφιας.
      kind = "PREP";
    }

    if (!kind) continue;

    conflicts.push({
      bookingId: other.id,
      bookingNumber: other.bookingNumber,
      kind,
      returnAt: new Date(oEnd).toISOString(),
      readyAt: new Date(oEnd + prep).toISOString(),
    });
  }

  // Πρώτα οι επικαλύψεις — είναι το σοβαρότερο εύρημα.
  return conflicts.sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === "OVERLAP" ? -1 : 1
  );
}
