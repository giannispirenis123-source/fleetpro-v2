export const dynamic = "force-dynamic";
// src/app/api/bookings/preview/route.ts
// Προεπισκόπηση τιμής της φόρμας κράτησης — ο ΙΔΙΟΣ κώδικας με την
// αποθήκευση (prepareBooking → priceBooking → computeQuoteForTenant), άρα
// και ίδια τιμή με το δημόσιο site. Δεν γράφει τίποτα· ο browser στέλνει μόνο ids.

import { z } from "zod";
import { badRequest, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { bookingFields, prepareBooking } from "@/lib/bookingCreate";

const schema = z.object({ customerId: z.string().min(1).optional(), ...bookingFields });

// POST /api/bookings/preview
export const POST = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      const parsed = schema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      const prepared = await prepareBooking({
        viewer: viewer!,
        data: { ...parsed.data, customerId: parsed.data.customerId ?? null },
        preview: true,
      });
      if (!prepared.ok) return prepared.response;
      const { plan } = prepared;
      return ok({
        breakdown: plan.breakdown,
        discountCode: plan.discountCode,
        autoPrice: plan.autoPrice,
        warnings: plan.warnings,
        quoteLines: plan.quoteLines,
      });
    } catch (error) {
      console.error("[FleetPro] booking preview:", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "bookings.view"
);
