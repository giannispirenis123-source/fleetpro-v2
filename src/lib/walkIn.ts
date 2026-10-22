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
import { contractCreateSchema, mainDriverFromCustomer } from "./contractForm";
import {
  FOLD_FROM,
  FOLD_TO,
  MIN_DIGITS,
  customerMatches,
  duplicateKeys,
  isDuplicateOf,
  searchQueryFor,
  type CustomerSearchField,
  type MatchableCustomer,
  type SearchQuery,
} from "./customerMatch";
import { blockedVehicleIds, loadBlockingBookings, windowOf } from "./public/availability";
import { tenantNowLocal } from "./bookingConflicts";
import { splitVatInclusive, type VatSplit } from "./invoices";
import { toDisplayBreakdown, type DisplayBreakdown, type PriceBreakdown } from "./pricing";
import type { QuoteLine } from "./public/pricing";
import { textFor } from "./public/text";

/* ─────────────────────────────────────────────
   Zod
   ───────────────────────────────────────────── */

export const walkInSchema = z
  .object({
    /** Υπάρχων πελάτης (επιλογή από τη λίστα)· αλλιώς νέος από τον κύριο οδηγό. */
    customerId: z.string().min(1).optional(),
    /** Ο χρήστης είδε τον πιθανό διπλότυπο και θέλει ΟΝΤΩΣ νέο πελάτη. */
    allowDuplicate: z.boolean().optional(),
    /** Μόνο προεπισκόπηση τιμής/σύγκρουσης — καμία εγγραφή. */
    preview: z.boolean().optional(),
    /** Τα στοιχεία του συμβολαίου (οδηγοί, πληρωμή, GDPR κ.λπ.). */
    contract: contractCreateSchema.optional(),
    ...bookingFields,
  })
  // Εγγραφή: χρειάζονται τα στοιχεία του συμβολαίου. Όνομα/τηλέφωνο του
  // κύριου οδηγού ΔΕΝ είναι υποχρεωτικά εδώ: η φόρμα τα ζητά (κόκκινα) αλλά
  // ο χρήστης μπορεί να αποθηκεύσει ούτως ή άλλως. Για υπογραφή χρειάζεται
  // όνομα (έλεγχος στο /sign).
  .refine((d) => d.preview || !!d.contract, {
    message: "Λείπουν τα στοιχεία του συμβολαίου",
    path: ["contract"],
  });

export type WalkInInput = z.infer<typeof walkInSchema>;

/* ─────────────────────────────────────────────
   Πελάτες: αναζήτηση και διπλότυπα
   ───────────────────────────────────────────── */

/**
 * Ό,τι χρειάζεται η λίστα — ΤΙΠΟΤΑ παραπάνω (όχι email, έγγραφα,
 * διεύθυνση): όνομα, τηλέφωνο, πλήθος κρατήσεων.
 */
export interface WalkInCustomer {
  id: string;
  name: string;
  phone: string | null;
  bookings: number;
  isBlacklisted: boolean;
}

type CustomerRow = MatchableCustomer & {
  id: string;
  isBlacklisted: boolean;
};

const toWalkInCustomer = (c: CustomerRow, bookings: number): WalkInCustomer => ({
  id: c.id,
  name: `${c.firstName} ${c.lastName}`.trim(),
  phone: c.phone,
  bookings,
  isBlacklisted: c.isBlacklisted,
});

/**
 * Το πλήθος κρατήσεων ΜΟΝΟ για όσους θα εμφανιστούν (έως 8), με ένα
 * ερώτημα — όχι υποερώτημα για κάθε έναν από τους έως 200 υποψήφιους.
 */
async function withBookingCounts(tenantId: string, rows: CustomerRow[]): Promise<WalkInCustomer[]> {
  if (rows.length === 0) return [];
  const counts = await db.booking.groupBy({
    by: ["customerId"],
    where: { tenantId, customerId: { in: rows.map((r) => r.id) } },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((c) => [c.customerId, c._count._all]));
  return rows.map((r) => toWalkInCustomer(r, byId.get(r.id) ?? 0));
}

/** LIKE με ασφαλή χαρακτήρες: τα % _ \ του χρήστη μετρούν κυριολεκτικά. */
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Η στήλη κανονικοποιημένη όπως το foldText (ίδιος χάρτης χαρακτήρων). */
const folded = (column: Prisma.Sql) =>
  Prisma.sql`translate(lower(coalesce(${column}, '')), ${FOLD_FROM}, ${FOLD_TO})`;

const digitsOf = (column: Prisma.Sql) =>
  Prisma.sql`regexp_replace(coalesce(${column}, ''), '\\D', '', 'g')`;

/** Ευρύ φίλτρο σε SQL· η τελική απόφαση είναι του customerMatches. */
function prefilter(field: CustomerSearchField, q: SearchQuery): Prisma.Sql {
  const col = (name: string) => Prisma.raw(`"${name}"`);
  if (q.kind === "digits") {
    return Prisma.sql`(${digitsOf(col("phone"))} LIKE ${like(q.digits)} OR ${digitsOf(col("phone2"))} LIKE ${like(q.digits)})`;
  }
  if (q.kind === "doc") {
    const c = col(field === "idNumber" ? "idNumber" : "licenseNumber");
    return q.digits.length >= MIN_DIGITS
      ? Prisma.sql`${digitsOf(c)} LIKE ${like(q.digits)}`
      : Prisma.sql`coalesce(${c}, '') <> ''`;
  }
  const words = q.words.map((w) => {
    if (field === "email") return Prisma.sql`${folded(col("email"))} LIKE ${like(w)}`;
    if (field === "address") {
      return Prisma.sql`(${folded(col("address"))} LIKE ${like(w)} OR ${folded(col("city"))} LIKE ${like(w)})`;
    }
    return Prisma.sql`(${folded(col("firstName"))} LIKE ${like(w)} OR ${folded(col("lastName"))} LIKE ${like(w)})`;
  });
  return Prisma.join(words, " AND ");
}

async function customerRows(tenantId: string, where: Prisma.Sql, limit: number) {
  return db.$queryRaw<CustomerRow[]>(Prisma.sql`
    SELECT c."id", c."firstName", c."lastName", c."phone", c."phone2", c."email",
           c."idNumber", c."licenseNumber", c."address", c."city", c."isBlacklisted"
    FROM "customers" c
    WHERE c."tenantId" = ${tenantId} AND ${where}
    ORDER BY c."lastName" ASC, c."firstName" ASC
    LIMIT ${limit}
  `);
}

/**
 * Πελάτες που ταιριάζουν σε ένα πεδίο του κύριου οδηγού (όνομα,
 * τηλέφωνο, email, ταυτότητα, δίπλωμα, διεύθυνση). Tenant-scoped, έως 8.
 */
export async function searchWalkInCustomers(
  tenantId: string,
  field: CustomerSearchField,
  raw: string
): Promise<WalkInCustomer[]> {
  const q = searchQueryFor(field, raw);
  if (!q) return [];
  const rows = await customerRows(tenantId, prefilter(field, q), 200);
  return withBookingCounts(
    tenantId,
    rows.filter((r) => customerMatches(r, field, q)).slice(0, 8)
  );
}

/** Υπάρχοντες πελάτες με το ίδιο τηλέφωνο ή email — υποψήφιοι διπλότυποι. */
export async function findDuplicateCustomers(
  tenantId: string,
  phone: string,
  email: string
): Promise<WalkInCustomer[]> {
  const keys = duplicateKeys(phone, email);
  if (!keys.phone && !keys.email) return [];

  const conditions: Prisma.Sql[] = [];
  if (keys.phone) {
    const end = `%${keys.phone}`;
    conditions.push(
      Prisma.sql`(${digitsOf(Prisma.raw('c."phone"'))} LIKE ${end} OR ${digitsOf(Prisma.raw('c."phone2"'))} LIKE ${end})`
    );
  }
  if (keys.email) conditions.push(Prisma.sql`lower(trim(c."email")) = ${keys.email}`);

  const rows = await customerRows(tenantId, Prisma.sql`(${Prisma.join(conditions, " OR ")})`, 20);
  return withBookingCounts(
    tenantId,
    rows.filter((r) => isDuplicateOf(r, { phone, email })).slice(0, 5)
  );
}

/** Όλα τα στοιχεία ενός πελάτη για τον κύριο οδηγό (μετά από επιλογή). */
export async function customerAsDriver(tenantId: string, id: string) {
  const c = await db.customer.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!c) return null;
  const { signature: _s, signedAt: _a, id: _id, ...driver } = await mainDriverFromCustomer(tenantId, c.id);
  return driver;
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
 * Τα οχήματα που είναι ελεύθερα στο διάστημα, με τον ΙΔΙΟ κανόνα με το site
 * και τον έλεγχο σύγκρουσης (src/lib/public/availability.ts): ίδιο ερώτημα,
 * καταστάσεις, προετοιμασία, καθυστερήσεις, αλλαγές οχήματος. Ένα ερώτημα για
 * όλο τον στόλο αντί για ένα ανά όχημα.
 */
export async function loadWalkInVehicles(
  tenantId: string,
  window: { pickupDate: string; pickupTime: string; returnDate: string; returnTime: string },
  includeUnavailable: boolean
): Promise<WalkInVehicle[]> {
  const now = new Date();
  const from = `${window.pickupDate}T${window.pickupTime}`;
  const to = `${window.returnDate}T${window.returnTime}`;
  const [tenant, vehicles, bookings, nowL] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { prepTimeMinutes: true } }),
    db.vehicle.findMany({
      where: { tenantId, isActive: true, status: { notIn: ["MAINTENANCE", "INACTIVE"] } },
      orderBy: [{ brand: "asc" }, { model: "asc" }, { plate: "asc" }],
      select: { id: true, brand: true, model: true, plate: true, dailyRate: true },
    }),
    loadBlockingBookings(db, tenantId, { from, to }, now),
    tenantNowLocal(db, tenantId, now),
  ]);

  const interval = windowOf({ from, to });
  const blocked = interval
    ? blockedVehicleIds(
        { companyId: tenantId, vehicles: [], bookings, from, to, prepMinutes: tenant?.prepTimeMinutes ?? 0, now: nowL, instantMs: now.getTime() },
        interval
      )
    : new Set<string>();

  const out: WalkInVehicle[] = [];
  for (const v of vehicles) {
    const available = !!interval && !blocked.has(v.id);
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
  /** Οι ακριβείς γραμμές (για τη χειροκίνητη τιμή: «Προσαρμογή τιμής»). */
  parts: { subtotal: number; extrasTotal: number; insuranceCost: number; discountAmount: number };
  vat: VatSplit;
  discountCode: string | null;
  conflicts: unknown[];
  /** false = δεν υπάρχει τιμή στις ρυθμίσεις → χειροκίνητη τιμή. */
  autoPrice: boolean;
  /** Μηνύματα της τιμής (π.χ. ελάχιστες ημέρες σεζόν) — ενημερωτικά. */
  warnings: string[];
  /** Η ανάλυση της quote() — ίδια με του site. */
  quoteLines: { label: { el: string; en: string }; totalCents: number; kind: string }[];
}

/** Η τιμή όπως τη βγάζει ο server (priceBooking), με ανάλυση ΦΠΑ. */
export async function toWalkInPreview(
  viewer: Viewer,
  priced: {
    breakdown: PriceBreakdown;
    dailyRate: number;
    discountCode: string | null;
    autoPrice: boolean;
    warnings: string[];
    quoteLines: QuoteLine[];
    quote: { manualDiscount: { cents: number; code: string | null } | null };
  },
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
    parts: {
      subtotal: priced.breakdown.subtotal,
      extrasTotal: priced.breakdown.extrasTotal,
      insuranceCost: priced.breakdown.insuranceCost,
      discountAmount: priced.breakdown.discountAmount,
    },
    vat: splitVatInclusive(display.total, Number(tenant?.vatRate ?? 0)),
    discountCode: priced.discountCode,
    conflicts,
    autoPrice: priced.autoPrice,
    warnings: priced.warnings,
    quoteLines: [
      ...priced.quoteLines.map((l) => ({
        label: { el: textFor(l.label, "el"), en: textFor(l.label, "en") },
        totalCents: l.totalCents,
        kind: l.kind as string,
      })),
      ...(priced.quote.manualDiscount
        ? [{
            label: {
              el: priced.quote.manualDiscount.code ? `Κωδικός έκπτωσης ${priced.quote.manualDiscount.code}` : "Έκπτωση",
              en: priced.quote.manualDiscount.code ? `Discount code ${priced.quote.manualDiscount.code}` : "Discount",
            },
            totalCents: -priced.quote.manualDiscount.cents,
            kind: "manual_discount",
          }]
        : []),
    ],
  };
}
