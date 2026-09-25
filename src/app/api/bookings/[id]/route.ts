export const dynamic = "force-dynamic";
// src/app/api/bookings/[id]/route.ts
// Επεξεργασία, μεταβάσεις κατάστασης και ακύρωση κράτησης.
// Κάθε ερώτημα φιλτράρει ΚΑΙ με tenantId από το session.

import { z } from "zod";
import { db } from "@/lib/db";
import {
  ok,
  badRequest,
  conflict,
  forbidden,
  notFound,
  serverError,
} from "@/lib/api";
import { withPermission, sessionCan, bookingScope } from "@/lib/authz";
import { resolvePartnerId } from "@/lib/partners";
import {
  BOOKING_STATUSES,
  STATUS_TRANSITIONS,
  TIME_RE,
  countDays,
  instantOf,
  toBookingDTO,
} from "@/lib/bookings";
import { checkVehicleConflicts } from "@/lib/bookingConflicts";
import { priceBooking } from "@/lib/bookingPricing";
import { applyDiscountUsage } from "@/lib/discounts";
import { issueInvoiceForBooking } from "@/lib/invoiceIssue";
import { DISCOUNT_MODES, readExtrasSnapshot } from "@/lib/pricing";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Μορφή ημερομηνίας: YYYY-MM-DD");

const isoTime = z.string().regex(TIME_RE, "Μορφή ώρας: HH:mm");

const updateBookingSchema = z.object({
  customerId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
  pickupDate: isoDate.optional(),
  pickupTime: isoTime.optional(),
  returnDate: isoDate.optional(),
  returnTime: isoTime.optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  notes: z.union([z.string(), z.null()]).optional(),
  /** Ρητή έγκριση διαχειριστή για να περάσει παρά τη σύγκρουση. */
  override: z.boolean().optional(),

  /* ── Τιμολόγηση: μόνο επιλογές, ποτέ ποσά ── */
  extraIds: z.array(z.string().min(1)).optional(),
  discountMode: z.enum(DISCOUNT_MODES).optional(),
  discountValue: z.number().min(0).optional(),
  discountCode: z.union([z.string(), z.null()]).optional(),

  /** Αλλαγή συνεργάτη. Ο ίδιος ο συνεργάτης δεν μπορεί να την κάνει. */
  partnerId: z.union([z.string(), z.null()]).optional(),
});

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const withRelations = {
  vehicle: { select: { brand: true, model: true, plate: true } },
  customer: { select: { firstName: true, lastName: true } },
  invoice: { select: { invoiceNumber: true } },
  partner: { select: { id: true, name: true, commissionRate: true } },
} as const;

/**
 * Ευθυγραμμίζει την κατάσταση του οχήματος με τις κρατήσεις του.
 * Δεσμευμένο αν υπάρχει έστω μία κράτηση σε CONFIRMED ή ACTIVE· αλλιώς
 * ελεύθερο — αλλά ποτέ δεν πειράζουμε όχημα σε συντήρηση ή ανενεργό.
 */
async function syncVehicleStatus(vehicleId: string, tenantId: string) {
  const vehicle = await db.vehicle.findFirst({
    where: { id: vehicleId, tenantId },
    select: { id: true, status: true },
  });
  if (!vehicle) return;
  if (vehicle.status === "MAINTENANCE" || vehicle.status === "INACTIVE") return;

  const held = await db.booking.count({
    where: { tenantId, vehicleId, status: { in: ["CONFIRMED", "ACTIVE"] } },
  });

  const next = held > 0 ? "RENTED" : "AVAILABLE";
  if (next !== vehicle.status) {
    await db.vehicle.update({ where: { id: vehicle.id }, data: { status: next } });
  }
}

// PATCH /api/bookings/[id]
export const PATCH = withPermission(
  async (req, session, params, viewer) => {
    try {
      // Το bookingScope κόβει τον συνεργάτη από κρατήσεις άλλων: δεν
      // παίρνει 403 «υπάρχει αλλά δεν επιτρέπεται», παίρνει «δεν βρέθηκε».
      const current = await db.booking.findFirst({
        where: { id: params!.id, ...bookingScope(viewer!) },
      });
      if (!current) return notFound("Η κράτηση δεν βρέθηκε");

      const body = await req.json();
      const parsed = updateBookingSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;

      // Έλεγχος μετάβασης: επιτρέπονται μόνο οι δηλωμένες διαδρομές.
      if (data.status && data.status !== current.status) {
        // Η αλλαγή κατάστασης είναι ξεχωριστό δικαίωμα από την απλή
        // επεξεργασία στοιχείων: άλλο να διορθώσεις μια ώρα και άλλο να
        // ενεργοποιήσεις ή να ολοκληρώσεις μια ενοικίαση.
        if (!(await sessionCan(session, "bookings.status"))) {
          return forbidden("Δεν έχετε δικαίωμα αλλαγής κατάστασης κράτησης");
        }

        const allowed = STATUS_TRANSITIONS[current.status] ?? [];
        if (!allowed.includes(data.status)) {
          return badRequest(
            `Μη επιτρεπτή μετάβαση: ${current.status} → ${data.status}`
          );
        }
      }

      const pickup = data.pickupDate ?? current.pickupDate.toISOString().slice(0, 10);
      const ret = data.returnDate ?? current.returnDate.toISOString().slice(0, 10);
      const pickupTime = data.pickupTime ?? current.pickupTime;
      const returnTime = data.returnTime ?? current.returnTime;

      if (instantOf(ret, returnTime, "end") <= instantOf(pickup, pickupTime, "start")) {
        return badRequest("Η επιστροφή πρέπει να είναι μετά την παραλαβή");
      }

      // Αν αλλάζει πελάτης ή όχημα, πρέπει να ανήκουν στην ίδια εταιρία.
      if (data.customerId && data.customerId !== current.customerId) {
        const customer = await db.customer.findFirst({
          where: { id: data.customerId, tenantId: session.tenantId! },
          select: { id: true },
        });
        if (!customer) return badRequest("Ο πελάτης δεν βρέθηκε");
      }

      // Το όχημα που θα κρατά η κράτηση μετά την ενημέρωση.
      const vehicleId = data.vehicleId ?? current.vehicleId;

      // Έλεγχος σύγκρουσης μόνο όσο η κράτηση διεκδικεί το όχημα. Αν
      // ακυρώνεται ή ολοκληρώνεται, το αφήνει ελεύθερο και δεν μας νοιάζει.
      const nextStatus = data.status ?? current.status;
      const claimsVehicle = nextStatus !== "CANCELLED" && nextStatus !== "COMPLETED";

      if (claimsVehicle) {
        const tenant = await db.tenant.findUnique({
          where: { id: session.tenantId! },
          select: { prepTimeMinutes: true },
        });

        const conflicts = await checkVehicleConflicts({
          tenantId: session.tenantId!,
          vehicleId,
          excludeBookingId: current.id,
          pickupDate: pickup,
          pickupTime,
          returnDate: ret,
          returnTime,
          prepMinutes: tenant?.prepTimeMinutes ?? 0,
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
      }

      const totalDays = countDays(pickup, ret);

      // Ό,τι δεν στάλθηκε μένει όπως ήταν — τα πρόσθετα διαβάζονται από το
      // snapshot της κράτησης, ώστε μια απλή αλλαγή ημερομηνίας να μην τα χάνει.
      const extraIds =
        data.extraIds ?? readExtrasSnapshot(current.extras).map((l) => l.id);

      const discountMode =
        data.discountMode ??
        (current.discountCode
          ? "CODE"
          : Number(current.discountAmount) > 0
            ? "AMOUNT"
            : "NONE");

      const discountValue =
        data.discountValue ??
        (discountMode === "AMOUNT" ? Number(current.discountAmount) : undefined);

      const priced = await priceBooking({
        tenantId: session.tenantId!,
        vehicleId,
        customerId: data.customerId ?? current.customerId,
        totalDays,
        extraIds,
        discountMode,
        discountValue,
        discountCode: data.discountCode ?? current.discountCode,
      });

      if (!priced.ok) return badRequest(priced.message);

      const { breakdown } = priced;

      const partner = await resolvePartnerId({
        viewer: viewer!,
        requested: data.partnerId,
        current: current.partnerId,
      });
      if (!partner.ok) return badRequest(partner.message);

      const booking = await db.booking.update({
        where: { id: current.id },
        data: {
          partnerId: partner.partnerId,
          ...(data.customerId !== undefined && { customerId: data.customerId }),
          ...(data.vehicleId !== undefined && { vehicleId: data.vehicleId }),
          ...(data.pickupDate !== undefined && { pickupDate: toDate(pickup) }),
          ...(data.pickupTime !== undefined && { pickupTime: data.pickupTime }),
          ...(data.returnDate !== undefined && { returnDate: toDate(ret) }),
          ...(data.returnTime !== undefined && { returnTime: data.returnTime }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
          dailyRate: priced.dailyRate,
          totalDays: breakdown.totalDays,
          subtotal: breakdown.subtotal,
          extrasTotal: breakdown.extrasTotal,
          insuranceCost: breakdown.insuranceCost,
          discountAmount: breakdown.discountAmount,
          discountCode: priced.discountCode,
          total: breakdown.total,
          extras: priced.snapshot as never,
        },
        include: withRelations,
      });

      // Μεταφορά χρήσης: μείωση του παλιού κωδικού, αύξηση του νέου. Αν
      // είναι ο ίδιος, δεν γίνεται τίποτα.
      //
      // ΜΟΝΟ η ακύρωση ελευθερώνει τη χρήση. Μια ολοκληρωμένη κράτηση
      // όντως χρησιμοποίησε την έκπτωση και συνεχίζει να τη μετράει.
      // Μια ήδη ακυρωμένη κράτηση έχει ήδη επιστρέψει τη χρήση της, οπότε
      // δεν την αφαιρούμε δεύτερη φορά.
      await applyDiscountUsage({
        tenantId: session.tenantId!,
        previousCode:
          current.status === "CANCELLED" ? null : current.discountCode,
        nextCode:
          booking.status === "CANCELLED" ? null : booking.discountCode,
      });

      // Ενημερώνουμε και το παλιό όχημα, αν άλλαξε.
      await syncVehicleStatus(booking.vehicleId, session.tenantId!);
      if (current.vehicleId !== booking.vehicleId) {
        await syncVehicleStatus(current.vehicleId, session.tenantId!);
      }

      // Αυτόματη έκδοση τιμολογίου με το τέλος της ενοικίασης.
      //
      // Δεν κοιτάμε αν ΜΟΛΙΣ πέρασε σε COMPLETED: η έκδοση είναι από μόνη
      // της ιδεμποτική (μία κράτηση → ένα τιμολόγιο), οπότε ένα δεύτερο
      // PATCH σε ήδη ολοκληρωμένη κράτηση δεν φτιάχνει δεύτερο τιμολόγιο.
      let invoiceNumber = booking.invoice?.invoiceNumber ?? null;

      if (booking.status === "COMPLETED") {
        const tenant = await db.tenant.findUnique({
          where: { id: session.tenantId! },
          select: { invoiceIssueTrigger: true },
        });

        if (tenant?.invoiceIssueTrigger === "ON_COMPLETION") {
          const outcome = await issueInvoiceForBooking({
            tenantId: session.tenantId!,
            bookingId: booking.id,
          });

          // Αποτυχία έκδοσης δεν γυρίζει πίσω την ολοκλήρωση της
          // κράτησης — καταγράφεται και το τιμολόγιο βγαίνει χειροκίνητα.
          if (outcome.ok) {
            invoiceNumber = outcome.invoiceNumber;
          } else {
            console.error("Αυτόματη έκδοση τιμολογίου:", outcome.message);
          }
        }
      }

      return ok({ booking: { ...toBookingDTO(booking), invoiceNumber } });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "bookings.edit"
);

// DELETE /api/bookings/[id] — ακύρωση, όχι σβήσιμο.
// Η κράτηση κρατά αριθμό και ιστορικό· απλώς περνά σε CANCELLED και το όχημα
// ελευθερώνεται αν δεν το κρατά κάποια άλλη.
export const DELETE = withPermission(
  async (_req, session, params, viewer) => {
    try {
      const current = await db.booking.findFirst({
        where: { id: params!.id, ...bookingScope(viewer!) },
      });
      if (!current) return notFound("Η κράτηση δεν βρέθηκε");

      if (current.status === "CANCELLED") {
        return badRequest("Η κράτηση είναι ήδη ακυρωμένη");
      }
      if (current.status === "COMPLETED") {
        return badRequest("Ολοκληρωμένη κράτηση δεν ακυρώνεται");
      }

      const booking = await db.booking.update({
        where: { id: current.id },
        data: { status: "CANCELLED" },
        include: withRelations,
      });

      // Η ακύρωση ελευθερώνει τη χρήση του κωδικού.
      await applyDiscountUsage({
        tenantId: session.tenantId!,
        previousCode: current.discountCode,
        nextCode: null,
      });

      await syncVehicleStatus(booking.vehicleId, session.tenantId!);

      return ok({ booking: toBookingDTO(booking) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "bookings.cancel"
);
