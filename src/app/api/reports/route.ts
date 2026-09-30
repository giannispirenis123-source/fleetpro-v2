export const dynamic = "force-dynamic";
// src/app/api/reports/route.ts
// Ετήσια αναφορά: έσοδα ανά μήνα (χωρίς ΦΠΑ), top οχήματα, κατηγορίες, KPIs.
// Όλα τα σύνολα υπολογίζονται εδώ από τη βάση — ο client δεν στέλνει ποσά.

import { ok, badRequest, forbidden, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { loadReport, parseYear } from "@/lib/reportsQuery";

// GET /api/reports?year=YYYY
export const GET = withPermission(
  async (req, session) => {
    // Ο συνεργάτης βλέπει μόνο τις δικές του κρατήσεις· τα σύνολα της
    // εταιρίας θα αποκάλυπταν και των άλλων.
    if (session.role === "PARTNER") return forbidden();

    try {
      const parsed = parseYear(new URL(req.url).searchParams);
      if (!parsed.ok) return badRequest(parsed.message);

      return ok({ report: await loadReport(session.tenantId!, parsed.year) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "reports.view"
);
