export const dynamic = "force-dynamic";
// src/app/api/public-site/domain/route.ts
// «Η σελίδα μου» → «Domain»: το domain του site της εταιρίας.
// ΜΟΝΟ Διαχειριστής εταιρίας + πακέτο με publicSite (storefrontAccess), στον
// server. Η εταιρία ΠΑΝΤΑ από τη συνεδρία· κανένα domain άλλης εταιρίας ή της
// πλατφόρμας. Νέο domain = PENDING μέχρι το «Έλεγχος domain» (verify).

import { z } from "zod";
import { badRequest, conflict, forbidden, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { storefrontAccess } from "@/lib/storefront/admin";
import { requestHost } from "@/lib/storefront/domain";
import { clearDomain, loadDomainAdmin, saveDomain } from "@/lib/storefront/domainServer";

const schema = z.object({ domain: z.string().min(1).max(300) });

// GET /api/public-site/domain
export const GET = withPermission(async (_req, _session, _params, viewer) => {
  try {
    const access = await storefrontAccess(viewer);
    if (!access.ok) return forbidden(access.message);
    return ok(await loadDomainAdmin(access.companyId));
  } catch (error) {
    console.error("[FleetPro] public-site domain GET:", error instanceof Error ? error.name : "");
    return serverError();
  }
}, "settings.edit");

// PUT /api/public-site/domain — { domain }
export const PUT = withPermission(async (req, _session, _params, viewer) => {
  try {
    const access = await storefrontAccess(viewer);
    if (!access.ok) return forbidden(access.message);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest("Γράψτε το domain, π.χ. www.helios-rent.gr");
    const r = await saveDomain(access.companyId, parsed.data.domain, requestHost((n) => req.headers.get(n)));
    if (!r.ok) return r.status === 409 ? conflict(r.message) : badRequest(r.message);
    return ok(await loadDomainAdmin(access.companyId));
  } catch (error) {
    console.error("[FleetPro] public-site domain PUT:", error instanceof Error ? error.name : "");
    return serverError();
  }
}, "settings.edit");

// DELETE /api/public-site/domain — το site σταματά να σερβίρεται στο domain.
export const DELETE = withPermission(async (_req, _session, _params, viewer) => {
  try {
    const access = await storefrontAccess(viewer);
    if (!access.ok) return forbidden(access.message);
    await clearDomain(access.companyId);
    return ok(await loadDomainAdmin(access.companyId));
  } catch (error) {
    console.error("[FleetPro] public-site domain DELETE:", error instanceof Error ? error.name : "");
    return serverError();
  }
}, "settings.edit");
