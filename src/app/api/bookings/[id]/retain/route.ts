export const dynamic = "force-dynamic";
// src/app/api/bookings/[id]/retain/route.ts
// «Το υπόλοιπο κρατείται»: σε ΑΚΥΡΩΜΕΝΗ κράτηση με online πληρωμή, ό,τι δεν
// επιστράφηκε γίνεται χρέωση ακύρωσης (booking_payments.retained*, SQL 28).
// ΜΟΝΟ Διαχειριστής (Υπάλληλος/Συνεργάτης: 403). Ιστορικό στο activity_logs.
// Η «Επιστροφή χρημάτων» μένει διαθέσιμη για το υπόλοιπο (διόρθωση λάθους).
// POST { note?: string }

import { z } from "zod";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { badRequest, forbidden, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { BOOKING_DTO_INCLUDE, toBookingDTO } from "@/lib/bookings";
import { RETAIN_MSG, RETAIN_NOTE_MAX, canRetain, checkRetain } from "@/lib/public/payments";
import { retainPayment } from "@/lib/public/paymentServer";
import { cleanNote } from "@/lib/bookingMessages";

const schema = z.object({ note: z.string().max(RETAIN_NOTE_MAX * 2).nullable().optional() });

export const POST = withPermission(
  async (req, session, params, viewer) => {
    try {
      if (!viewer || !canRetain(viewer.role)) return forbidden(RETAIN_MSG.role);
      const tenantId = session.tenantId;
      if (!tenantId) return forbidden();
      const parsed = schema.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα");

      const id = params!.id;
      const [booking, payment] = await Promise.all([
        db.booking.findFirst({ where: { id, tenantId }, select: { id: true, status: true } }),
        db.bookingPayment.findFirst({
          where: { tenantId, bookingId: id, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, amountCents: true, refundedCents: true, retainedCents: true },
        }),
      ]);
      const check = checkRetain(booking, payment);
      if (!check.ok) return NextResponse.json({ success: false, message: check.message }, { status: check.status });

      const done = await retainPayment({
        tenantId,
        userId: viewer.userId,
        paymentId: payment!.id,
        bookingId: id,
        retainedCents: check.retainedCents,
        addedCents: check.addedCents,
        note: cleanNote(parsed.data.note),
        readRefundedCents: payment!.refundedCents,
        readRetainedCents: payment!.retainedCents,
      });
      if (!done) return NextResponse.json({ success: false, message: RETAIN_MSG.changed }, { status: 409 });
      const row = await db.booking.findFirst({ where: { id, tenantId }, include: BOOKING_DTO_INCLUDE });
      return ok({ retainedCents: check.retainedCents, booking: row ? toBookingDTO(row) : null });
    } catch (error) {
      console.error("[FleetPro] retain:", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "bookings.view"
);
