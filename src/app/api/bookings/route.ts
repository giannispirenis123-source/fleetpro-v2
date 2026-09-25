export const dynamic = "force-dynamic";
// src/app/api/bookings/route.ts
// Κρατήσεις ανά tenant — λίστα και δημιουργία.
//
// Η τιμή ΔΕΝ έρχεται ποτέ από τη φόρμα: ο client στέλνει μόνο ids και
// επιλογές, και το priceBooking() την ξαναβγάζει από τη βάση.
//
// ΔΕΝ γίνεται ακόμη: ΦΠΑ και αυτόματο τιμολόγιο — σελίδα Τιμολογίων.

import { z } from "zod";
import { db } from "@/lib/db";
import {
  ok,
  created,
  badRequest,
  conflict,
  forbidden,
  serverError,
} from "@/lib/api";
import { withPermission, sessionCan, bookingScope } from "@/lib/authz";
import { resolvePartnerId } from "@/lib/partners";
import {
  BOOKING_STATUSES,
  RESERVING_STATUSES,
  TIME_RE,
  countDays,
  instantOf,
  toBookingDTO,
} from "@/lib/bookings";
import { checkVehicleConflicts } from "@/lib/bookingConflicts";
import { priceBooking } from "@/lib/bookingPricing";
import { applyDiscountUsage } from "@/lib/discounts";
import { DISCOUNT_MODES } from "@/lib/pricing";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Μορφή ημερομηνίας: YYYY-MM-DD");

const isoTime = z.string().regex(TIME_RE, "Μορφή ώρας: HH:mm");

const createBookingSchema = z.object({
  customerId: z.string().min(1, "Απαιτείται πελάτης"),
  vehicleId: z.string().min(1, "Απαιτείται όχημα"),
  pickupDate: isoDate,
  pickupTime: isoTime,
  returnDate: isoDate,
  returnTime: isoTime,
  status: z.enum(BOOKING_STATUSES).optional(),
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
});

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

/** BP-2025-001, αυξανόμενο ανά εταιρία και έτος. */
async function nextBookingNumber(tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `BP-${year}-`;

  const last = await db.booking.findFirst({
    where: { tenantId, bookingNumber: { startsWith: prefix } },
    orderBy: { bookingNumber: "desc" },
    select: { bookingNumber: true },
  });

  const lastSeq = last ? parseInt(last.bookingNumber.slice(prefix.length), 10) : 0;
  const next = (Number.isNaN(lastSeq) ? 0 : lastSeq) + 1;

  return `${prefix}${String(next).padStart(3, "0")}`;
}

// GET /api/bookings
export const GET = withPermission(
  async (req, session, _params, viewer) => {
    try {
      const url = new URL(req.url);
      const status = url.searchParams.get("status");

      const bookings = await db.booking.findMany({
        where: {
          // Ο συνεργάτης βλέπει μόνο τις δικές του — το φίλτρο μπαίνει
          // στο ερώτημα, όχι στην εμφάνιση.
          ...bookingScope(viewer!),
          ...(status ? { status: status as never } : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
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
        },
      });

      return ok(bookings.map(toBookingDTO));
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "bookings.view"
);

// POST /api/bookings
export const POST = withPermission(
  async (req, session, _params, viewer) => {
    try {
      const body = await req.json();
      const parsed = createBookingSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;

      const startsAt = instantOf(data.pickupDate, data.pickupTime, "start");
      const endsAt = instantOf(data.returnDate, data.returnTime, "end");

      if (endsAt <= startsAt) {
        return badRequest("Η επιστροφή πρέπει να είναι μετά την παραλαβή");
      }

      // Πελάτης και όχημα πρέπει να ανήκουν στην ίδια εταιρία με τον χρήστη.
      const [customer, vehicle, tenant] = await Promise.all([
        db.customer.findFirst({
          where: { id: data.customerId, tenantId: session.tenantId! },
          select: { id: true },
        }),
        db.vehicle.findFirst({
          where: { id: data.vehicleId, tenantId: session.tenantId! },
          select: { id: true, dailyRate: true },
        }),
        db.tenant.findUnique({
          where: { id: session.tenantId! },
          select: { rentalMode: true, prepTimeMinutes: true },
        }),
      ]);

      if (!customer) return badRequest("Ο πελάτης δεν βρέθηκε");
      if (!vehicle) return badRequest("Το όχημα δεν βρέθηκε");
      if (!tenant) return badRequest("Η εταιρία δεν βρέθηκε");

      // Έλεγχος σύγκρουσης: το όχημα δεν είναι ελεύθερο πριν περάσει ο
      // χρόνος προετοιμασίας από την προηγούμενη επιστροφή. Με σύγκρουση
      // προχωράμε μόνο αν ο διαχειριστής το εγκρίνει ρητά.
      const conflicts = await checkVehicleConflicts({
        tenantId: session.tenantId!,
        vehicleId: vehicle.id,
        pickupDate: data.pickupDate,
        pickupTime: data.pickupTime,
        returnDate: data.returnDate,
        returnTime: data.returnTime,
        prepMinutes: tenant.prepTimeMinutes,
      });

      if (conflicts.length > 0) {
        if (!data.override) {
          return conflict(
            "Το όχημα δεν είναι διαθέσιμο σε αυτό το διάστημα",
            conflicts
          );
        }
        if (!(await sessionCan(session, "bookings.override"))) {
          return forbidden("Η παράκαμψη απαιτεί έγκριση διαχειριστή");
        }
      }

      // Σε λειτουργία REQUEST κάθε νέα εγγραφή είναι αίτημα: μπαίνει PENDING
      // ανεξάρτητα από το τι ζήτησε η φόρμα, και το όχημα δεν δεσμεύεται.
      const status =
        tenant.rentalMode === "REQUEST" ? "PENDING" : data.status ?? "PENDING";

      const totalDays = countDays(data.pickupDate, data.returnDate);

      // Όλα τα ποσά ξαναϋπολογίζονται από τη βάση.
      const priced = await priceBooking({
        tenantId: session.tenantId!,
        vehicleId: vehicle.id,
        customerId: customer.id,
        totalDays,
        extraIds: data.extraIds ?? [],
        discountMode: data.discountMode ?? "NONE",
        discountValue: data.discountValue,
        discountCode: data.discountCode,
      });

      if (!priced.ok) return badRequest(priced.message);

      const { breakdown } = priced;

      // Ποιος συνεργάτης χρεώνεται την κράτηση. Αν τη γράφει ο ίδιος ο
      // συνεργάτης, είναι ο εαυτός του και τίποτα από το body δεν το
      // αλλάζει· αλλιώς ο διαχειριστής μπορεί να τη δέσει σε κάποιον.
      const partner = await resolvePartnerId({
        viewer: viewer!,
        requested: data.partnerId,
      });
      if (!partner.ok) return badRequest(partner.message);

      const booking = await db.booking.create({
        data: {
          tenantId: session.tenantId!,
          customerId: customer.id,
          vehicleId: vehicle.id,
          partnerId: partner.partnerId,
          // Ποιος την έγραψε — πάντα από το session, ποτέ από το body.
          createdById: session.userId,
          bookingNumber: await nextBookingNumber(session.tenantId!),
          status,
          pickupDate: toDate(data.pickupDate),
          pickupTime: data.pickupTime,
          returnDate: toDate(data.returnDate),
          returnTime: data.returnTime,
          dailyRate: priced.dailyRate,
          totalDays: breakdown.totalDays,
          subtotal: breakdown.subtotal,
          extrasTotal: breakdown.extrasTotal,
          insuranceCost: breakdown.insuranceCost,
          discountAmount: breakdown.discountAmount,
          discountCode: priced.discountCode,
          total: breakdown.total,
          // Snapshot: αν αλλάξει αργότερα η τιμή ενός πρόσθετου, η παλιά
          // κράτηση μένει όπως καταχωρήθηκε.
          extras: priced.snapshot as never,
          notes: data.notes?.trim() || null,
        },
        include: {
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
        },
      });

      // Η χρήση του κωδικού μετράει μόνο όταν η κράτηση όντως αποθηκεύτηκε
      // με αυτόν — ποτέ σε απλή προεπισκόπηση ή απορριφθέν αίτημα.
      await applyDiscountUsage({
        tenantId: session.tenantId!,
        previousCode: null,
        nextCode: priced.discountCode,
      });

      // Δέσμευση οχήματος μόνο όταν η κράτηση ξεκινά ήδη δεσμευτική.
      if (RESERVING_STATUSES.includes(status)) {
        await db.vehicle.update({
          where: { id: vehicle.id },
          data: { status: "RENTED" },
        });
      }

      return created({ booking: toBookingDTO(booking) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "bookings.create"
);
