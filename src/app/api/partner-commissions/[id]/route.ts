export const dynamic = "force-dynamic";
// src/app/api/partner-commissions/[id]/route.ts
// Οι κρατήσεις ΕΝΟΣ συνεργάτη της εταιρίας (ίδιος υπολογισμός με τα «Οικονομικά»
// του). Συνεργάτης άλλης εταιρίας ή όχι συνεργάτης → 404.

import { badRequest, forbidden, logError, notFound, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { loadPartnerCommissionDetail, periodFromSearch } from "@/lib/partnerServer";

// GET /api/partner-commissions/[id]?month=YYYY-MM
export const GET = withPermission(
  async (req, session, params, viewer) => {
    try {
      if (!viewer?.tenantId || viewer.role === "PARTNER" || viewer.role === "SUPER_ADMIN") return forbidden();
      // ?month=YYYY-MM | ?from=YYYY-MM-DD&to=YYYY-MM-DD | τίποτα (= όλοι οι μήνες)
      const p = periodFromSearch(new URL(req.url).searchParams, session.locale);
      if (!p.ok) return badRequest(p.message);
      const period = p.period;
      const detail = await loadPartnerCommissionDetail(viewer.tenantId, params!.id, period);
      return detail ? ok({ period, ...detail }) : notFound("Ο συνεργάτης δεν βρέθηκε");
    } catch (error) {
      logError("partner-commissions/[id]", error);
      return serverError();
    }
  },
  "commission.partners"
);
