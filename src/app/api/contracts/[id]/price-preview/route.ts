export const dynamic = "force-dynamic";
// src/app/api/contracts/[id]/price-preview/route.ts
// Προεπισκόπηση τιμής όταν αλλάζουν τα πρόσθετα ενός ΥΠΑΡΧΟΝΤΟΣ συμβολαίου.
// Ο ΙΔΙΟΣ υπολογισμός με την αποθήκευση (priceBookingExtras → computeQuoteForTenant).
// Δεν γράφει τίποτα. Ο browser στέλνει μόνο ids.

import { z } from "zod";
import { db } from "@/lib/db";
import { badRequest, notFound, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { contractScope, priceBookingExtras } from "@/lib/contractForm";
import { readExtrasSnapshot } from "@/lib/pricing";

const schema = z.object({ extraIds: z.array(z.string().min(1).max(64)).max(30) });

// POST /api/contracts/[id]/price-preview
export const POST = withPermission(
  async (req, _session, params, viewer) => {
    try {
      const parsed = schema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα");
      const contract = await db.contract.findFirst({
        where: { ...contractScope(viewer!), id: params!.id },
        select: { bookingId: true, booking: { select: { totalDays: true, dailyRate: true } } },
      });
      if (!contract) return notFound("Το συμβόλαιο δεν βρέθηκε");
      const priced = await priceBookingExtras(viewer!.tenantId!, contract.bookingId, parsed.data.extraIds);
      if (!priced.ok) return badRequest(priced.message);
      const d = priced.data as Record<string, unknown>;
      const num = (k: string, fallback: unknown) => Number(d[k] ?? fallback);
      const ids = parsed.data.extraIds;
      const excess = new Map(
        (await db.extra.findMany({ where: { id: { in: ids }, tenantId: viewer!.tenantId! }, select: { id: true, excess: true } })).map(
          (e) => [e.id, e.excess === null ? null : Number(e.excess)]
        )
      );
      return ok({
        totalDays: num("totalDays", contract.booking.totalDays),
        dailyRate: num("dailyRate", contract.booking.dailyRate),
        subtotal: num("subtotal", 0),
        extrasTotal: num("extrasTotal", 0),
        insuranceCost: num("insuranceCost", 0),
        discountAmount: num("discountAmount", 0),
        total: num("total", 0),
        lines: readExtrasSnapshot(d.extras).map((l) => ({ ...l, excess: excess.get(l.id) ?? null })),
      });
    } catch (error) {
      console.error("[FleetPro] contract price-preview:", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "contracts.edit"
);
