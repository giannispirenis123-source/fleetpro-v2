export const dynamic = "force-dynamic";
// src/app/api/partner-commissions/route.ts
// «Προμήθειες συνεργατών»: ανά συνεργάτη της ΕΤΑΙΡΙΑΣ (tenantId από το session)
// πλήθος, σύνολο κρατήσεων και προμήθεια — ΙΔΙΟΣ υπολογισμός με τα «Οικονομικά»
// του ίδιου του συνεργάτη. Διαχειριστής πάντα· προσωπικό μόνο με
// «commission.partners»· συνεργάτης ποτέ (PARTNER_NEVER στο can()).

import { badRequest, forbidden, logError, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { loadPartnerCommissions, periodFromSearch } from "@/lib/partnerServer";

// GET /api/partner-commissions?month=YYYY-MM | ?from=YYYY-MM-DD&to=YYYY-MM-DD   (κενό = όλοι οι μήνες)
export const GET = withPermission(
  async (req, session, _params, viewer) => {
    try {
      if (!viewer?.tenantId || viewer.role === "PARTNER" || viewer.role === "SUPER_ADMIN") return forbidden();
      // ?month=YYYY-MM | ?from=YYYY-MM-DD&to=YYYY-MM-DD | τίποτα (= όλοι οι μήνες)
      const p = periodFromSearch(new URL(req.url).searchParams, session.locale);
      if (!p.ok) return badRequest(p.message);
      const period = p.period;
      return ok({ period, ...(await loadPartnerCommissions(viewer.tenantId, period)) });
    } catch (error) {
      logError("partner-commissions", error);
      return serverError();
    }
  },
  "commission.partners"
);
