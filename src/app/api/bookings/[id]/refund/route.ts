export const dynamic = "force-dynamic";
// src/app/api/bookings/[id]/refund/route.ts
// «Επιστροφή χρημάτων» για ΑΚΥΡΩΜΕΝΗ κράτηση με online πληρωμή — ποτέ
// αυτόματα, μόνο με ρητή ενέργεια του Διαχειριστή (ο συνεργάτης/υπάλληλος: 403).
// Refund στον λογαριασμό Stripe ΤΗΣ ΕΤΑΙΡΙΑΣ· ιστορικό στο booking_payments.refunds.
// POST { amountCents: number | null }  (null = ό,τι απομένει)

import { z } from "zod";
import { db } from "@/lib/db";
import { badRequest, forbidden, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { BOOKING_DTO_INCLUDE, toBookingDTO } from "@/lib/bookings";
import { REFUND_MSG, canRefund, checkRefund } from "@/lib/public/payments";
import { refundPayment } from "@/lib/public/paymentServer";
import { stripeReady } from "@/lib/stripeConnect";
import { NextResponse } from "next/server";

const schema = z.object({ amountCents: z.number().int().positive().nullable() });

export const POST = withPermission(
  async (req, session, params, viewer) => {
    try {
      if (!viewer || !canRefund(viewer.role)) return forbidden(REFUND_MSG.role);
      const tenantId = session.tenantId;
      if (!tenantId) return forbidden();
      const parsed = schema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return badRequest("Μη έγκυρο ποσό");
      if (!stripeReady()) return badRequest(REFUND_MSG.notConfigured);

      const id = params!.id;
      const [booking, payment, tenant] = await Promise.all([
        db.booking.findFirst({ where: { id, tenantId }, select: { id: true, status: true } }),
        db.bookingPayment.findFirst({
          where: { tenantId, bookingId: id, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
          orderBy: { createdAt: "desc" },
        }),
        db.tenant.findUnique({ where: { id: tenantId }, select: { stripeAccountId: true } }),
      ]);
      const check = checkRefund(booking, payment, parsed.data.amountCents);
      if (!check.ok) return NextResponse.json({ success: false, message: check.message }, { status: check.status });
      if (!payment || !tenant?.stripeAccountId || payment.stripeAccountId !== tenant.stripeAccountId) {
        return badRequest(REFUND_MSG.notPaid);
      }

      const r = await refundPayment({ tenantId, userId: viewer.userId, accountId: tenant.stripeAccountId, payment, amountCents: check.amountCents });
      if (!r.ok) return NextResponse.json({ success: false, message: REFUND_MSG.stripe }, { status: r.status === 502 ? 502 : 400 });

      await db.activityLog.create({
        data: {
          tenantId,
          userId: viewer.userId,
          action: "booking.refund",
          entity: "Booking",
          entityId: id,
          newData: { amountCents: check.amountCents },
        },
      });
      const row = await db.booking.findFirst({
        where: { id, tenantId },
        include: BOOKING_DTO_INCLUDE,
      });
      return ok({ refundedCents: check.amountCents, booking: row ? toBookingDTO(row) : null });
    } catch (error) {
      console.error("[FleetPro] refund:", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "bookings.view"
);
