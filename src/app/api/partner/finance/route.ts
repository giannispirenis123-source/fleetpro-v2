export const dynamic = "force-dynamic";
// src/app/api/partner/finance/route.ts
// «Οικονομικά» του συνεργάτη: ΜΟΝΟ οι δικές του κρατήσεις (φίλτρο στο ερώτημα),
// ποσό και προμήθεια (υπάρχουσα λογική), σύνολα χωρίς ακυρωμένες/επιστραμμένες.

import { badRequest, forbidden, logError, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { monthRange } from "@/lib/partnerFinance";
import { isPartnerViewer, loadPartnerFinance } from "@/lib/partnerServer";

// GET /api/partner/finance?month=YYYY-MM   (κενό = όλοι οι μήνες)
export const GET = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      if (!isPartnerViewer(viewer)) return forbidden("Μόνο για συνεργάτες");
      const month = new URL(req.url).searchParams.get("month") || null;
      if (month && !monthRange(month)) return badRequest("Μη έγκυρος μήνας (YYYY-MM)");
      return ok({ month, ...(await loadPartnerFinance(viewer, month)) });
    } catch (error) {
      logError("partner/finance", error);
      return serverError();
    }
  },
  "commission.view"
);
