export const dynamic = "force-dynamic";
// src/app/api/bookings/[id]/decision/route.ts
// «Επιβεβαίωση» / «Ακύρωση» κράτησης από το dashboard + μήνυμα στον πελάτη.
//
// GET  → ό,τι χρειάζεται το παράθυρο: ελεύθερα οχήματα της ομάδας, στοιχεία
//        μηνύματος (στη γλώσσα του πελάτη), ιστορικό αποστολών και αλλαγών.
// POST { action: "confirm", vehicleId?, notify }
//      { action: "cancel", reasonCode?, note?, notify }
//
// Η εταιρία ΜΟΝΟ από τη συνεδρία. Ο συνεργάτης ΜΟΝΟ βλέπει (403).
// Η λογική ζει στο src/lib/bookingDecision.ts (ελέγχεται από τα tests).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { badRequest, forbidden, notFound, ok, serverError } from "@/lib/api";
import { withPermission, type Viewer } from "@/lib/authz";
import { decideBooking, decisionSchema, freeVehiclesFor, canDecide } from "@/lib/bookingDecision";
import {
  loadMessageContext,
  prismaDecisionStore,
  prismaMessageDeps,
  publicOrigin,
} from "@/lib/bookingDecisionServer";
import { loadBlockingBookings } from "@/lib/public/availability";
import { nowLocal } from "@/lib/public/search";
import { windowOfBooking } from "@/lib/bookingDecision";
import { BOOKING_PAYMENT_INCLUDE, toBookingDTO } from "@/lib/bookings";
import { emailFromForTenant } from "@/lib/emailSenderServer";

const noStore = { "Cache-Control": "no-store" };

const decider = (viewer: Viewer) =>
  canDecide(viewer.role, viewer.permissions, "confirm") || canDecide(viewer.role, viewer.permissions, "cancel");

// GET /api/bookings/[id]/decision
export const GET = withPermission(
  async (req, session, params, viewer) => {
    try {
      // Τα στοιχεία επικοινωνίας του πελάτη μόνο σε όσους διαχειρίζονται κρατήσεις.
      if (!decider(viewer!)) return forbidden("Δεν έχετε δικαίωμα για αυτή την ενέργεια");
      const tenantId = session.tenantId!;
      const id = params!.id;
      const b = await db.booking.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          tenantId: true,
          status: true,
          vehicleId: true,
          rentalGroupId: true,
          pickupDate: true,
          pickupTime: true,
          returnDate: true,
          returnTime: true,
        },
      });
      if (!b) return notFound("Η κράτηση δεν βρέθηκε");
      const booking = {
        ...b,
        pickupDate: b.pickupDate.toISOString().slice(0, 10),
        returnDate: b.returnDate.toISOString().slice(0, 10),
      };

      const [ctx, vehicles, blocking, tenant, notifications, history] = await Promise.all([
        loadMessageContext(tenantId, id, publicOrigin(req)),
        db.vehicle.findMany({
          where: { tenantId },
          select: { id: true, tenantId: true, rentalGroupId: true, status: true, isActive: true, brand: true, model: true, plate: true },
          orderBy: [{ brand: "asc" }, { model: "asc" }],
        }),
        loadBlockingBookings(db, tenantId, windowOfBooking(booking)),
        db.tenant.findUnique({ where: { id: tenantId }, select: { prepTimeMinutes: true } }),
        db.bookingNotification.findMany({
          where: { tenantId, bookingId: id },
          orderBy: { createdAt: "desc" },
          select: { kind: true, channel: true, result: true, error: true, createdAt: true },
        }),
        db.activityLog.findMany({
          where: { tenantId, entity: "Booking", entityId: id },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { action: true, createdAt: true, userId: true, user: { select: { name: true } } },
        }),
      ]);
      if (!ctx) return notFound("Η κράτηση δεν βρέθηκε");

      const free = new Set(freeVehiclesFor(booking, vehicles, blocking, tenant?.prepTimeMinutes ?? 0, nowLocal()));
      return NextResponse.json(
        {
          success: true,
          data: {
            status: b.status,
            fromSite: ctx.fromSite,
            currentVehicleId: b.vehicleId,
            currentVehicleFree: !!b.vehicleId && free.has(b.vehicleId),
            freeVehicles: vehicles
              .filter((v) => free.has(v.id))
              .map((v) => ({ id: v.id, label: `${v.brand} ${v.model} · ${v.plate}` })),
            message: { ...ctx.data, reasonCode: ctx.reasonCode, note: ctx.note },
            contact: { email: ctx.customerEmail, phone: ctx.customerPhone },
            notifications: notifications.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
            // userId = null ΜΟΝΟ μετά από οριστική διαγραφή (SQL 35) → «Διαγραμμένος χρήστης».
            history: history.map((h) => ({ action: h.action, at: h.createdAt.toISOString(), by: h.user?.name ?? null, byDeleted: h.userId === null })),
          },
        },
        { headers: noStore }
      );
    } catch (error) {
      console.error("[FleetPro] decision GET", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "bookings.view"
);

// POST /api/bookings/[id]/decision
export const POST = withPermission(
  async (req, session, params, viewer) => {
    try {
      const parsed = decisionSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα");
      const tenantId = session.tenantId ?? "";
      if (!tenantId) return forbidden();
      const id = params!.id;
      const origin = publicOrigin(req);

      const result = await decideBooking(
        viewer!,
        parsed.data,
        prismaDecisionStore(tenantId, id, viewer!.userId),
        prismaMessageDeps(tenantId, id, viewer!.userId, origin, await emailFromForTenant(tenantId))
      );
      if (result.status === 200) {
        const row = await db.booking.findFirst({
          where: { id, tenantId },
          include: {
            vehicle: { select: { brand: true, model: true, plate: true } },
            customer: { select: { firstName: true, lastName: true } },
            invoice: { select: { invoiceNumber: true, invoiceCode: true } },
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
            messages: { select: { kind: true, channel: true, result: true } },
            payments: BOOKING_PAYMENT_INCLUDE,
          },
        });
        return ok({ ...result.data, booking: row ? toBookingDTO(row) : null });
      }
      return NextResponse.json(
        { success: false, message: result.message, ...(result.freeVehicleIds ? { freeVehicleIds: result.freeVehicleIds } : {}) },
        { status: result.status }
      );
    } catch (error) {
      console.error("[FleetPro] decision POST", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "bookings.view"
);
