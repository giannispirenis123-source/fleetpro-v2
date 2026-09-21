export const dynamic = "force-dynamic";
// src/app/api/bookings/[id]/route.ts
// Επεξεργασία, μεταβάσεις κατάστασης και ακύρωση κράτησης.
// Κάθε ερώτημα φιλτράρει ΚΑΙ με tenantId από το session.

import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, serverError } from "@/lib/api";
import {
  BOOKING_STATUSES,
  STATUS_TRANSITIONS,
  countDays,
  toBookingDTO,
} from "@/lib/bookings";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Μορφή ημερομηνίας: YYYY-MM-DD");

const updateBookingSchema = z.object({
  customerId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
  pickupDate: isoDate.optional(),
  returnDate: isoDate.optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  notes: z.union([z.string(), z.null()]).optional(),
});

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const withRelations = {
  vehicle: { select: { brand: true, model: true, plate: true } },
  customer: { select: { firstName: true, lastName: true } },
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
export const PATCH = withAuth(
  async (req, session, params) => {
    try {
      const current = await db.booking.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
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
        const allowed = STATUS_TRANSITIONS[current.status] ?? [];
        if (!allowed.includes(data.status)) {
          return badRequest(
            `Μη επιτρεπτή μετάβαση: ${current.status} → ${data.status}`
          );
        }
      }

      const pickup = data.pickupDate ?? current.pickupDate.toISOString().slice(0, 10);
      const ret = data.returnDate ?? current.returnDate.toISOString().slice(0, 10);

      if (ret < pickup) {
        return badRequest("Η επιστροφή δεν μπορεί να προηγείται της παραλαβής");
      }

      // Αν αλλάζει πελάτης ή όχημα, πρέπει να ανήκουν στην ίδια εταιρία.
      if (data.customerId && data.customerId !== current.customerId) {
        const customer = await db.customer.findFirst({
          where: { id: data.customerId, tenantId: session.tenantId! },
          select: { id: true },
        });
        if (!customer) return badRequest("Ο πελάτης δεν βρέθηκε");
      }

      let dailyRate = Number(current.dailyRate);
      if (data.vehicleId && data.vehicleId !== current.vehicleId) {
        const vehicle = await db.vehicle.findFirst({
          where: { id: data.vehicleId, tenantId: session.tenantId! },
          select: { id: true, dailyRate: true },
        });
        if (!vehicle) return badRequest("Το όχημα δεν βρέθηκε");
        dailyRate = Number(vehicle.dailyRate);
      }

      const totalDays = countDays(pickup, ret);
      const subtotal = dailyRate * totalDays;

      const booking = await db.booking.update({
        where: { id: current.id },
        data: {
          ...(data.customerId !== undefined && { customerId: data.customerId }),
          ...(data.vehicleId !== undefined && { vehicleId: data.vehicleId }),
          ...(data.pickupDate !== undefined && { pickupDate: toDate(pickup) }),
          ...(data.returnDate !== undefined && { returnDate: toDate(ret) }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
          dailyRate,
          totalDays,
          subtotal,
          total: subtotal,
        },
        include: withRelations,
      });

      // Ενημερώνουμε και το παλιό όχημα, αν άλλαξε.
      await syncVehicleStatus(booking.vehicleId, session.tenantId!);
      if (current.vehicleId !== booking.vehicleId) {
        await syncVehicleStatus(current.vehicleId, session.tenantId!);
      }

      return ok({ booking: toBookingDTO(booking) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN", "STAFF"]
);

// DELETE /api/bookings/[id] — ακύρωση, όχι σβήσιμο.
// Η κράτηση κρατά αριθμό και ιστορικό· απλώς περνά σε CANCELLED και το όχημα
// ελευθερώνεται αν δεν το κρατά κάποια άλλη.
export const DELETE = withAuth(
  async (_req, session, params) => {
    try {
      const current = await db.booking.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
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

      await syncVehicleStatus(booking.vehicleId, session.tenantId!);

      return ok({ booking: toBookingDTO(booking) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN", "STAFF"]
);
