// src/lib/bookingCreate.ts
// Η δημιουργία κράτησης ΣΤΟΝ SERVER — μία φορά, για όλους.
//
// Το χρησιμοποιούν το POST /api/bookings και το γρήγορο συμβόλαιο
// (walk-in), ώστε η κράτηση να βγαίνει ΠΑΝΤΑ με τον ίδιο τρόπο:
// ξαναϋπολογισμός από ids (ποσά του client αγνοούνται), έλεγχος
// σύγκρουσης με χρόνο προετοιμασίας, override μόνο με bookings.override,
// snapshot πρόσθετων, createdById από το session, χρήση κωδικού έκπτωσης.
//
// Δύο βήματα:
//   1. prepareBooking — μόνο αναγνώσεις και έλεγχοι· επιστρέφει «σχέδιο»
//      ή έτοιμη απάντηση σφάλματος.
//   2. writeBooking — οι εγγραφές, μέσα σε transaction που δίνει ο καλών.
//
// Server-only: εισάγει db.

import type { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { badRequest, conflict, forbidden } from "./api";
import { viewerCan, type Viewer } from "./authz";
import { resolvePartnerId } from "./partners";
import {
  BOOKING_STATUSES,
  RESERVING_STATUSES,
  TIME_RE,
  countDays,
  instantOf,
  type BookingConflict,
  type BookingStatusValue,
} from "./bookings";
import { checkVehicleConflicts } from "./bookingConflicts";
import { priceBooking } from "./bookingPricing";
import { applyDiscountUsage } from "./discounts";
import { DISCOUNT_MODES, type PriceBreakdown } from "./pricing";

/** Το κοινό `db` ή μια transaction. */
type Client = Prisma.TransactionClient | typeof db;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Μορφή ημερομηνίας: YYYY-MM-DD");

const isoTime = z.string().regex(TIME_RE, "Μορφή ώρας: HH:mm");

/** Τα κοινά πεδία κάθε νέας κράτησης — χωρίς πελάτη. */
export const bookingFields = {
  vehicleId: z.string().min(1, "Απαιτείται όχημα"),
  pickupDate: isoDate,
  pickupTime: isoTime,
  returnDate: isoDate,
  returnTime: isoTime,
  notes: z.union([z.string(), z.null()]).optional(),
  /** Ρητή έγκριση διαχειριστή για να περάσει παρά τη σύγκρουση. */
  override: z.boolean().optional(),

  /* ── Τιμολόγηση: μόνο επιλογές, ποτέ ποσά ──
     Τυχόν total/subtotal στο body τα πετάει το zod — δεν διαβάζονται. */
  extraIds: z.array(z.string().min(1)).optional(),
  /** Ο συνεργάτης που έφερε την κράτηση. Αγνοείται όταν γράφει συνεργάτης. */
  partnerId: z.union([z.string(), z.null()]).optional(),
  discountMode: z.enum(DISCOUNT_MODES).optional(),
  discountValue: z.number().min(0).optional(),
  discountCode: z.union([z.string(), z.null()]).optional(),
};

export const createBookingSchema = z.object({
  customerId: z.string().min(1, "Απαιτείται πελάτης"),
  status: z.enum(BOOKING_STATUSES).optional(),
  ...bookingFields,
});

type BookingFields = z.infer<z.ZodObject<typeof bookingFields>>;

/** Ό,τι χρειάζεται το writeBooking — όλα ελεγμένα και υπολογισμένα. */
export interface BookingPlan {
  tenantId: string;
  vehicleId: string;
  /** null = νέος πελάτης που θα φτιαχτεί μέσα στην ίδια transaction. */
  customerId: string | null;
  partnerId: string | null;
  createdById: string;
  status: BookingStatusValue;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  notes: string | null;
  source: string;
  dailyRate: number;
  breakdown: PriceBreakdown;
  snapshot: unknown;
  discountCode: string | null;
}

export type PrepareOutcome =
  | { ok: true; plan: BookingPlan; conflicts: BookingConflict[] }
  | { ok: false; response: NextResponse };

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

/**
 * Έλεγχοι και υπολογισμοί μιας νέας κράτησης, χωρίς καμία εγγραφή.
 *
 * - `status`: ό,τι ζήτησε η φόρμα. Σε λειτουργία REQUEST γίνεται PENDING.
 * - `forceStatus`: η κατάσταση ανεξάρτητα από rentalMode (walk-in: ο
 *   πελάτης είναι παρών, το όχημα δεσμεύεται αμέσως → CONFIRMED).
 * - `preview`: για την προεπισκόπηση — η σύγκρουση ΔΕΝ σταματά τίποτα,
 *   απλώς επιστρέφεται.
 */
export async function prepareBooking(opts: {
  viewer: Viewer;
  data: BookingFields & { customerId: string | null; status?: BookingStatusValue };
  forceStatus?: BookingStatusValue;
  source?: string;
  preview?: boolean;
}): Promise<PrepareOutcome> {
  const { viewer, data } = opts;
  const tenantId = viewer.tenantId!;
  const fail = (response: NextResponse) => ({ ok: false as const, response });

  const startsAt = instantOf(data.pickupDate, data.pickupTime, "start");
  const endsAt = instantOf(data.returnDate, data.returnTime, "end");

  if (endsAt <= startsAt) {
    return fail(badRequest("Η επιστροφή πρέπει να είναι μετά την παραλαβή"));
  }

  // Πελάτης και όχημα πρέπει να ανήκουν στην ίδια εταιρία με τον χρήστη.
  const [customer, vehicle, tenant] = await Promise.all([
    data.customerId
      ? db.customer.findFirst({
          where: { id: data.customerId, tenantId },
          select: { id: true },
        })
      : null,
    db.vehicle.findFirst({
      where: { id: data.vehicleId, tenantId },
      select: { id: true },
    }),
    db.tenant.findUnique({
      where: { id: tenantId },
      select: { rentalMode: true, prepTimeMinutes: true },
    }),
  ]);

  if (data.customerId && !customer) return fail(badRequest("Ο πελάτης δεν βρέθηκε"));
  if (!vehicle) return fail(badRequest("Το όχημα δεν βρέθηκε"));
  if (!tenant) return fail(badRequest("Η εταιρία δεν βρέθηκε"));

  // Έλεγχος σύγκρουσης: το όχημα δεν είναι ελεύθερο πριν περάσει ο
  // χρόνος προετοιμασίας από την προηγούμενη επιστροφή. Με σύγκρουση
  // προχωράμε μόνο αν ο διαχειριστής το εγκρίνει ρητά.
  const conflicts = await checkVehicleConflicts({
    tenantId,
    vehicleId: vehicle.id,
    pickupDate: data.pickupDate,
    pickupTime: data.pickupTime,
    returnDate: data.returnDate,
    returnTime: data.returnTime,
    prepMinutes: tenant.prepTimeMinutes,
  });

  if (conflicts.length > 0 && !opts.preview) {
    if (!data.override) {
      return fail(conflict("Το όχημα δεν είναι διαθέσιμο σε αυτό το διάστημα", conflicts));
    }
    if (!viewerCan(viewer, "bookings.override")) {
      return fail(forbidden("Η παράκαμψη απαιτεί έγκριση διαχειριστή"));
    }
  }

  // Σε λειτουργία REQUEST κάθε νέα εγγραφή είναι αίτημα: μπαίνει PENDING
  // ανεξάρτητα από το τι ζήτησε η φόρμα, και το όχημα δεν δεσμεύεται.
  const status: BookingStatusValue =
    opts.forceStatus ??
    (tenant.rentalMode === "REQUEST" ? "PENDING" : data.status ?? "PENDING");

  // Όλα τα ποσά ξαναϋπολογίζονται από τη βάση. Νέος πελάτης δεν έχει id
  // ακόμα: κωδικός δεμένος σε πελάτη απλώς δεν ισχύει γι' αυτόν.
  const priced = await priceBooking({
    tenantId,
    vehicleId: vehicle.id,
    customerId: customer?.id ?? "",
    totalDays: countDays(data.pickupDate, data.returnDate),
    extraIds: data.extraIds ?? [],
    discountMode: data.discountMode ?? "NONE",
    discountValue: data.discountValue,
    discountCode: data.discountCode,
  });

  if (!priced.ok) return fail(badRequest(priced.message));

  // Ποιος συνεργάτης χρεώνεται την κράτηση. Αν τη γράφει ο ίδιος ο
  // συνεργάτης, είναι ο εαυτός του και τίποτα από το body δεν το
  // αλλάζει· αλλιώς ο διαχειριστής μπορεί να τη δέσει σε κάποιον.
  const partner = await resolvePartnerId({ viewer, requested: data.partnerId });
  if (!partner.ok) return fail(badRequest(partner.message));

  return {
    ok: true,
    conflicts,
    plan: {
      tenantId,
      vehicleId: vehicle.id,
      customerId: customer?.id ?? null,
      partnerId: partner.partnerId,
      // Ποιος την έγραψε — πάντα από το session, ποτέ από το body.
      createdById: viewer.userId,
      status,
      pickupDate: data.pickupDate,
      pickupTime: data.pickupTime,
      returnDate: data.returnDate,
      returnTime: data.returnTime,
      notes: data.notes?.trim() || null,
      source: opts.source ?? "manual",
      dailyRate: priced.dailyRate,
      breakdown: priced.breakdown,
      snapshot: priced.snapshot,
      discountCode: priced.discountCode,
    },
  };
}

/** BP-2025-001, αυξανόμενο ανά εταιρία και έτος. */
async function nextBookingNumber(client: Client, tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `BP-${year}-`;

  const last = await client.booking.findFirst({
    where: { tenantId, bookingNumber: { startsWith: prefix } },
    orderBy: { bookingNumber: "desc" },
    select: { bookingNumber: true },
  });

  const lastSeq = last ? parseInt(last.bookingNumber.slice(prefix.length), 10) : 0;
  const next = (Number.isNaN(lastSeq) ? 0 : lastSeq) + 1;

  return `${prefix}${String(next).padStart(3, "0")}`;
}

export const BOOKING_INCLUDE = {
  vehicle: { select: { brand: true, model: true, plate: true } },
  customer: { select: { firstName: true, lastName: true } },
  invoice: { select: { invoiceNumber: true } },
  partner: {
    select: {
      id: true,
      name: true,
      commissionRate: true,
      commissionOnRental: true,
      commissionOnExtras: true,
      commissionOnInsurance: true,
    },
  },
  createdBy: { select: { id: true, name: true } },
} as const;

/**
 * Οι εγγραφές της νέας κράτησης. Ο καλών δίνει την transaction, ώστε
 * μαζί της να γράφονται (ή να μη γράφεται τίποτα) πελάτης και συμβόλαιο.
 */
export async function writeBooking(tx: Client, plan: BookingPlan, customerId: string) {
  const { breakdown } = plan;

  const booking = await tx.booking.create({
    data: {
      tenantId: plan.tenantId,
      customerId,
      vehicleId: plan.vehicleId,
      partnerId: plan.partnerId,
      createdById: plan.createdById,
      bookingNumber: await nextBookingNumber(tx, plan.tenantId),
      status: plan.status,
      source: plan.source,
      pickupDate: toDate(plan.pickupDate),
      pickupTime: plan.pickupTime,
      returnDate: toDate(plan.returnDate),
      returnTime: plan.returnTime,
      dailyRate: plan.dailyRate,
      totalDays: breakdown.totalDays,
      subtotal: breakdown.subtotal,
      extrasTotal: breakdown.extrasTotal,
      insuranceCost: breakdown.insuranceCost,
      discountAmount: breakdown.discountAmount,
      discountCode: plan.discountCode,
      total: breakdown.total,
      // Snapshot: αν αλλάξει αργότερα η τιμή ενός πρόσθετου, η παλιά
      // κράτηση μένει όπως καταχωρήθηκε.
      extras: plan.snapshot as never,
      notes: plan.notes,
    },
    include: BOOKING_INCLUDE,
  });

  // Η χρήση του κωδικού μετράει μόνο όταν η κράτηση όντως αποθηκεύτηκε
  // με αυτόν — ποτέ σε απλή προεπισκόπηση ή απορριφθέν αίτημα.
  await applyDiscountUsage(
    { tenantId: plan.tenantId, previousCode: null, nextCode: plan.discountCode },
    tx
  );

  // Δέσμευση οχήματος μόνο όταν η κράτηση ξεκινά ήδη δεσμευτική.
  if (RESERVING_STATUSES.includes(plan.status)) {
    await tx.vehicle.update({
      where: { id: plan.vehicleId },
      data: { status: "RENTED" },
    });
  }

  return booking;
}
