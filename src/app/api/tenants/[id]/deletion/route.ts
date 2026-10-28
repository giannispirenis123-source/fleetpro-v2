export const dynamic = "force-dynamic";
// src/app/api/tenants/[id]/deletion/route.ts
// GET — τι θα σβηστεί αν διαγραφεί η εταιρία (πλήθη, μπλοκάρισμα συνδρομής,
// Stripe Connect, θέση ιδρυτή). ΜΟΝΟ Super Admin· δεν αλλάζει τίποτα.

import { withAuth, ok, notFound, serverError, logError } from "@/lib/api";
import { tenantDeleteSummary } from "@/lib/tenantDelete";

export const GET = withAuth(
  async (_req, _session, params) => {
    try {
      const s = await tenantDeleteSummary(params!.id);
      return s ? ok(s) : notFound("Η εταιρία δεν βρέθηκε");
    } catch (error) {
      logError("tenants/[id]/deletion", error);
      return serverError();
    }
  },
  ["SUPER_ADMIN"]
);
