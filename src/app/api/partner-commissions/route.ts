export const dynamic = "force-dynamic";
// src/app/api/partner-commissions/route.ts
// «Προμήθειες συνεργατών»: ανά συνεργάτη της ΕΤΑΙΡΙΑΣ (tenantId από το session)
// πλήθος, σύνολο κρατήσεων και προμήθεια — ΙΔΙΟΣ υπολογισμός με τα «Οικονομικά»
// του ίδιου του συνεργάτη. Διαχειριστής πάντα· προσωπικό μόνο με
// «commission.partners»· συνεργάτης ποτέ (PARTNER_NEVER στο can()).

import { badRequest, forbidden, logError, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { monthRange } from "@/lib/partnerFinance";
import { loadPartnerCommissions } from "@/lib/partnerServer";

// GET /api/partner-commissions?month=YYYY-MM   (κενό = όλοι οι μήνες)
export const GET = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      if (!viewer?.tenantId || viewer.role === "PARTNER" || viewer.role === "SUPER_ADMIN") return forbidden();
      const month = new URL(req.url).searchParams.get("month") || null;
      if (month && !monthRange(month)) return badRequest("Μη έγκυρος μήνας (YYYY-MM)");
      return ok({ month, ...(await loadPartnerCommissions(viewer.tenantId, month)) });
    } catch (error) {
      logError("partner-commissions", error);
      return serverError();
    }
  },
  "commission.partners"
);
