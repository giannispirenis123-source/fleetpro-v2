// src/lib/walkIn.ts
// Γρήγορο συμβόλαιο «walk-in»: πελάτης στο γκισέ, χωρίς προϋπάρχουσα
// κράτηση. Στην πρώτη αποθήκευση ο server φτιάχνει σε ΜΙΑ transaction
// (α) νέο πελάτη αν χρειάζεται, (β) την κράτηση — με τον ΙΔΙΟ κώδικα του
// POST κράτησης (bookingCreate.ts) — και (γ) το συμβόλαιο.
//
// Server-only: εισάγει db.

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import type { Viewer } from "./authz";
import { bookingFields } from "./bookingCreate";
import { CONFLICT_STATUSES, findConflicts } from "./bookings";
import { splitVatInclusive, type VatSplit } from "./invoices";
import { toDisplayBreakdown, type DisplayBreakdown, type PriceBreakdown } from "./pricing";

/* ─────────────────────────────────────────────
   Zod
   ───────────────────────────────────────────── */

const newCustomerSchema = z
  .object({
    firstName: z.string().trim().min(1, "Απαιτείται όνομα").max(100),
    lastName: z.string().trim().min(1, "Απαιτείται επώνυμο").max(100),
    phone: z.string().trim().min(5, "Απαιτείται τηλέφωνο").max(40),
    email: z.union([z.string().trim().email("Μη έγκυρο email").max(200), z.literal("")]).optional(),
  })
  .strict();

export const walkInSchema = z
  .object({
    customerId: z.string().min(1).optional(),
    newCustomer: newCustomerSchema.optional(),
    /** Ο χρήστης είδε τον πιθανό διπλότυπο και θέλει ΟΝΤΩΣ νέο πελάτη. */
    allowDuplicate: z.boolean().optional(),
    /** Μόνο προεπισκόπηση τιμής/σύγκρουσης — καμία εγγραφή. */
    preview: z.boolean().optional(),
    ...bookingFields,
  })
  // Στην προεπισκόπηση ο πελάτης μπορεί να μην έχει οριστεί ακόμα.
  .refine((d) => (d.preview && !(d.customerId && d.newCustomer)) || Boolean(d.customerId) !== Boolean(d.newCustomer), {
    message: "Διάλεξε υπάρχοντα πελάτη ή συμπλήρωσε νέο",
    path: ["customerId"],
  });

export type WalkInInput = z.infer<typeof walkInSchema>;

/* ─────────────────────────────────────────────
   Πελάτες: αναζήτηση και διπλότυπα
   ───────────────────────────────────────────── */

export interface WalkInCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isBlacklisted: boolean;
}

const toWalkInCustomer = (c: {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  isBlacklisted: boolean;
}): WalkInCustomer => ({
  id: c.id,
  name: `${c.firstName} ${c.lastName}`.trim(),
  phone: c.phone,
  email: c.email,
  isBlacklisted: c.isBlacklisted,
});

const CUSTOMER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  isBlacklisted: true,
} as const;

/**
 * Τα ψηφία ενός τηλεφώνου χωρίς κενά/σύμβολα και χωρίς το +30/0030,
 * ώστε «+30 694 123 4567» = «6941234567».
 */
export function phoneDigits(phone: string): string {
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("30") && d.length === 12) d = d.slice(2);
  return d;
}

/** Ids πελατών της εταιρίας που το τηλέφωνό τους τελειώνει σε αυτά τα ψηφία. */
async function idsByPhoneDigits(tenantId: string, digits: string, anywhere: boolean) {
  const pattern = anywhere ? `%${digits}%` : `%${digits}`;
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "customers"
    WHERE "tenantId" = ${tenantId}
      AND (regexp_replace(coalesce("phone", ''), '\\D', '', 'g') LIKE ${pattern}
        OR regexp_replace(coalesce("phone2", ''), '\\D', '', 'g') LIKE ${pattern})
    LIMIT 10
  `);
  return rows.map((r) => r.id);
}

/** Αναζήτηση με όνομα, επώνυμο, email ή τηλέφωνο (και χωρίς κενά/+30). */
export async function searchWalkInCustomers(
  tenantId: string,
  q: string
): Promise<WalkInCustomer[]> {
  const term = q.trim();
  if (term.length < 2) return [];

  const words = term.split(/\s+/).filter(Boolean).slice(0, 4);
  const digits = phoneDigits(term);
  const phoneIds = digits.length >= 3 ? await idsByPhoneDigits(tenantId, digits, true) : [];

  const rows = await db.customer.findMany({
    where: {
      tenantId,
      OR: [
        // Κάθε λέξη σε όνομα, επώνυμο ή email («Γιάννης Παπ» βρίσκει).
        {
          AND: words.map((w) => ({
            OR: [
              { firstName: { contains: w, mode: "insensitive" as const } },
              { lastName: { contains: w, mode: "insensitive" as const } },
              { email: { contains: w, mode: "insensitive" as const } },
            ],
          })),
        },
        ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
      ],
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 10,
    select: CUSTOMER_SELECT,
  });
  return rows.map(toWalkInCustomer);
}

/** Υπάρχοντες πελάτες με το ίδιο τηλέφωνο ή email — υποψήφιοι διπλότυποι. */
export async function findDuplicateCustomers(
  tenantId: string,
  phone: string,
  email: string
): Promise<WalkInCustomer[]> {
  const digits = phoneDigits(phone);
  // Ταίριασμα στα τελευταία 10 ψηφία: αρκετά για να μη μπερδεύει ξένους.
  const key = digits.length > 10 ? digits.slice(-10) : digits;
  const phoneIds = key.length >= 7 ? await idsByPhoneDigits(tenantId, key, false) : [];
  const mail = email.trim();

  if (!phoneIds.length && !mail) return [];

  const rows = await db.customer.findMany({
    where: {
      tenantId,
      OR: [
        ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
        ...(mail ? [{ email: { equals: mail, mode: "insensitive" as const } }] : []),
      ],
    },
    take: 5,
    select: CUSTOMER_SELECT,
  });
  return rows.map(toWalkInCustomer);
}

/* ─────────────────────────────────────────────
   Διαθέσιμα οχήματα
   ───────────────────────────────────────────── */

export interface WalkInVehicle {
  id: string;
  brand: string;
  model: string;
  plate: string;
  dailyRate: number;
  /** false μόνο όταν ζητήθηκαν και τα μη διαθέσιμα (override). */
  available: boolean;
}

/**
 * Τα οχήματα που είναι ελεύθερα στο διάστημα, με τον ΙΔΙΟ έλεγχο
 * σύγκρουσης/προετοιμασίας των κρατήσεων (findConflicts). Ένα ερώτημα για
 * όλο τον στόλο αντί για ένα ανά όχημα.
 */
export async function loadWalkInVehicles(
  tenantId: string,
  window: { pickupDate: string; pickupTime: string; returnDate: string; returnTime: string },
  includeUnavailable: boolean
): Promise<WalkInVehicle[]> {
  // Η προετοιμασία μπορεί να «περάσει» στην επόμενη ημέρα: κοιτάμε και
  // κρατήσεις που επιστρέφουν λίγες ημέρες πριν την παραλαβή.
  const from = new Date(`${window.pickupDate}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 3);
  const until = new Date(`${window.returnDate}T00:00:00.000Z`);

  const [tenant, vehicles, bookings] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { prepTimeMinutes: true } }),
    db.vehicle.findMany({
      where: { tenantId, isActive: true, status: { notIn: ["MAINTENANCE", "INACTIVE"] } },
      orderBy: [{ brand: "asc" }, { model: "asc" }, { plate: "asc" }],
      select: { id: true, brand: true, model: true, plate: true, dailyRate: true },
    }),
    db.booking.findMany({
      where: {
        tenantId,
        status: { in: CONFLICT_STATUSES as never[] },
        returnDate: { gte: from },
        pickupDate: { lte: until },
      },
      select: {
        id: true,
        vehicleId: true,
        bookingNumber: true,
        pickupDate: true,
        pickupTime: true,
        returnDate: true,
        returnTime: true,
      },
    }),
  ]);

  const byVehicle = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const list = byVehicle.get(b.vehicleId) ?? [];
    list.push(b);
    byVehicle.set(b.vehicleId, list);
  }

  const out: WalkInVehicle[] = [];
  for (const v of vehicles) {
    const others = (byVehicle.get(v.id) ?? []).map((r) => ({
      id: r.id,
      bookingNumber: r.bookingNumber,
      pickupDate: r.pickupDate.toISOString().slice(0, 10),
      pickupTime: r.pickupTime,
      returnDate: r.returnDate.toISOString().slice(0, 10),
      returnTime: r.returnTime,
    }));
    const available = findConflicts(window, others, tenant?.prepTimeMinutes ?? 0).length === 0;
    if (!available && !includeUnavailable) continue;
    out.push({
      id: v.id,
      brand: v.brand,
      model: v.model,
      plate: v.plate,
      dailyRate: Number(v.dailyRate),
      available,
    });
  }
  return out;
}

/* ─────────────────────────────────────────────
   Προεπισκόπηση τιμής
   ───────────────────────────────────────────── */

export interface WalkInPreview {
  totalDays: number;
  dailyRate: number;
  lines: { name: string; type: string; lineTotal: number }[];
  display: DisplayBreakdown;
  vat: VatSplit;
  discountCode: string | null;
  conflicts: unknown[];
}

/** Η τιμή όπως τη βγάζει ο server (priceBooking), με ανάλυση ΦΠΑ. */
export async function toWalkInPreview(
  viewer: Viewer,
  priced: { breakdown: PriceBreakdown; dailyRate: number; discountCode: string | null },
  conflicts: unknown[]
): Promise<WalkInPreview> {
  const tenant = await db.tenant.findUnique({
    where: { id: viewer.tenantId! },
    select: { vatRate: true },
  });
  const display = toDisplayBreakdown(priced.breakdown);
  return {
    totalDays: priced.breakdown.totalDays,
    dailyRate: priced.dailyRate,
    lines: priced.breakdown.lines.map((l) => ({
      name: l.name,
      type: l.type,
      lineTotal: l.lineTotal,
    })),
    display,
    vat: splitVatInclusive(display.total, Number(tenant?.vatRate ?? 0)),
    discountCode: priced.discountCode,
    conflicts,
  };
}
