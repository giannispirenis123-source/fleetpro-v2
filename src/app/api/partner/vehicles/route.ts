export const dynamic = "force-dynamic";
// src/app/api/partner/vehicles/route.ts
// Τα ΔΙΑΘΕΣΙΜΑ οχήματα για το διάστημα της κράτησης του συνεργάτη — ίδια
// λογική με τη φόρμα του προσωπικού (loadWalkInVehicles). Μόνο id + ετικέτα.

import { z } from "zod";
import { badRequest, forbidden, logError, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { TIME_RE } from "@/lib/bookings";
import { isPartnerViewer, loadPartnerVehicles } from "@/lib/partnerServer";

const windowSchema = z.object({
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickupTime: z.string().regex(TIME_RE),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnTime: z.string().regex(TIME_RE),
});

// GET /api/partner/vehicles?pickupDate=&pickupTime=&returnDate=&returnTime=
export const GET = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      if (!isPartnerViewer(viewer)) return forbidden("Μόνο για συνεργάτες");
      const parsed = windowSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
      if (!parsed.success) return badRequest("Μη έγκυρο διάστημα");
      const w = parsed.data;
      if (`${w.returnDate}T${w.returnTime}` <= `${w.pickupDate}T${w.pickupTime}`) {
        return badRequest("Η επιστροφή πρέπει να είναι μετά την παραλαβή");
      }
      return ok({ vehicles: await loadPartnerVehicles(viewer, w) });
    } catch (error) {
      logError("partner/vehicles", error);
      return serverError();
    }
  },
  "partner.book"
);
