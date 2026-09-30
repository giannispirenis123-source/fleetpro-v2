export const dynamic = "force-dynamic";
// src/app/api/finance/summary/route.ts
// Σύνοψη διαστήματος: καθαρά έσοδα (χωρίς ΦΠΑ), έξοδα, κέρδος, κατανομή.
// Όλα τα σύνολα υπολογίζονται εδώ από τη βάση — ο client δεν στέλνει ποσά.

import { ok, badRequest, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { loadSummary, parseRange } from "@/lib/financeForm";

// GET /api/finance/summary?month=YYYY-MM | from=&to=
export const GET = withPermission(
  async (req, session) => {
    try {
      const parsed = parseRange(new URL(req.url).searchParams);
      if (!parsed.ok) return badRequest(parsed.message);

      return ok({ summary: await loadSummary(session.tenantId!, parsed.range) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "finance.view"
);
