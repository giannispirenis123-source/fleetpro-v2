export const dynamic = "force-dynamic";
// src/app/api/partner-commissions/[id]/route.ts
// Οι κρατήσεις ΕΝΟΣ συνεργάτη της εταιρίας (ίδιος υπολογισμός με τα «Οικονομικά»
// του). Συνεργάτης άλλης εταιρίας ή όχι συνεργάτης → 404.

import { badRequest, forbidden, logError, notFound, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { monthRange } from "@/lib/partnerFinance";
import { loadPartnerCommissionDetail } from "@/lib/partnerServer";

// GET /api/partner-commissions/[id]?month=YYYY-MM
export const GET = withPermission(
  async (req, _session, params, viewer) => {
    try {
      if (!viewer?.tenantId || viewer.role === "PARTNER" || viewer.role === "SUPER_ADMIN") return forbidden();
      const month = new URL(req.url).searchParams.get("month") || null;
      if (month && !monthRange(month)) return badRequest("Μη έγκυρος μήνας (YYYY-MM)");
      const detail = await loadPartnerCommissionDetail(viewer.tenantId, params!.id, month);
      return detail ? ok({ month, ...detail }) : notFound("Ο συνεργάτης δεν βρέθηκε");
    } catch (error) {
      logError("partner-commissions/[id]", error);
      return serverError();
    }
  },
  "commission.partners"
);
