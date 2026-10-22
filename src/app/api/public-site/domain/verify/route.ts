export const dynamic = "force-dynamic";
// src/app/api/public-site/domain/verify/route.ts
// «Έλεγχος domain»: DNS lookup (A/CNAME, με όριο χρόνου) από τον server για το
// domain της ΙΔΙΑΣ εταιρίας (από τη βάση, ποτέ από το body). Δείχνει στο
// Vercel → VERIFIED. ΜΟΝΟ Διαχειριστής + publicSite. Καμία κλήση στο Vercel API.

import { badRequest, forbidden, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { storefrontAccess } from "@/lib/storefront/admin";
import { loadDomainAdmin, verifyDomain } from "@/lib/storefront/domainServer";

// POST /api/public-site/domain/verify
export const POST = withPermission(async (_req, _session, _params, viewer) => {
  try {
    const access = await storefrontAccess(viewer);
    if (!access.ok) return forbidden(access.message);
    const r = await verifyDomain(access.companyId);
    if (!r.ok) return badRequest(r.message);
    return ok({ verdict: r.verdict, domain: await loadDomainAdmin(access.companyId) });
  } catch (error) {
    console.error("[FleetPro] public-site domain verify:", error instanceof Error ? error.name : "");
    return serverError();
  }
}, "settings.edit");
