export const dynamic = "force-dynamic";
// src/app/api/partner/availability/route.ts
// Διαθεσιμότητα για τον συνεργάτη: ΜΟΝΟ η δική του εταιρία, ΜΟΝΟ ελεύθερο /
// κατειλημμένο ανά όχημα και ημέρα — χωρίς πελάτες ή στοιχεία κρατήσεων.

import { badRequest, forbidden, logError, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { MAX_AVAILABILITY_DAYS } from "@/lib/partnerAvailability";
import { isPartnerViewer, loadPartnerAvailability } from "@/lib/partnerServer";

// GET /api/partner/availability?from=YYYY-MM-DD&days=14
export const GET = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      if (!isPartnerViewer(viewer)) return forbidden("Μόνο για συνεργάτες");
      const sp = new URL(req.url).searchParams;
      const from = sp.get("from") ?? new Date().toISOString().slice(0, 10);
      const days = Number(sp.get("days") ?? 14);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !Number.isInteger(days) || days < 1 || days > MAX_AVAILABILITY_DAYS) {
        return badRequest("Μη έγκυρο διάστημα");
      }
      const grid = await loadPartnerAvailability(viewer, from, days);
      return grid ? ok(grid) : badRequest("Μη έγκυρο διάστημα");
    } catch (error) {
      logError("partner/availability", error);
      return serverError();
    }
  },
  "partner.availability"
);
