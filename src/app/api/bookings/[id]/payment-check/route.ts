export const dynamic = "force-dynamic";
// src/app/api/bookings/[id]/payment-check/route.ts
// «Έλεγχος πληρωμής στο Stripe»: εφεδρική επιβεβαίωση χωρίς webhook για
// AWAITING_PAYMENT / EXPIRED / FAILED. Ίδια μετάβαση με το webhook (ίδιοι
// έλεγχοι, ίδια idempotency). Διαχειριστής και Υπάλληλος· Συνεργάτης: 403.
// Όριο 1 ανά 10΄΄ ανά κράτηση.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { forbidden, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { BOOKING_DTO_INCLUDE, toBookingDTO } from "@/lib/bookings";
import { canCheckPayment, isCheckable } from "@/lib/public/payments";
import { checkBookingPayment } from "@/lib/public/paymentServer";

export const POST = withPermission(
  async (_req, session, params, viewer) => {
    try {
      if (!viewer || !canCheckPayment(viewer.role)) return forbidden("Δεν έχετε δικαίωμα για αυτή την ενέργεια");
      const tenantId = session.tenantId;
      if (!tenantId) return forbidden();
      const id = params!.id;
      const b = await db.booking.findFirst({ where: { id, tenantId }, select: { paymentMethod: true, paymentStatus: true } });
      if (!b) return NextResponse.json({ success: false, message: "Η κράτηση δεν βρέθηκε" }, { status: 404 });
      if (!isCheckable(b)) return NextResponse.json({ success: false, message: "Δεν υπάρχει εκκρεμής online πληρωμή για έλεγχο." }, { status: 400 });

      const outcome = await checkBookingPayment(tenantId, id);
      if (outcome === "rate_limited") {
        return NextResponse.json({ success: false, message: "Μόλις έγινε έλεγχος. Δοκιμάστε ξανά σε λίγα δευτερόλεπτα." }, { status: 429 });
      }
      if (outcome === "stripe_error" || outcome === "not_ready") {
        return NextResponse.json({ success: false, message: "Το Stripe δεν απάντησε. Δοκιμάστε ξανά σε λίγο." }, { status: 502 });
      }
      const row = await db.booking.findFirst({ where: { id, tenantId }, include: BOOKING_DTO_INCLUDE });
      return ok({ outcome, booking: row ? toBookingDTO(row) : null });
    } catch (error) {
      console.error("[FleetPro] payment check:", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "bookings.view"
);
