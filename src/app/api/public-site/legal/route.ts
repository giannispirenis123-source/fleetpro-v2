export const dynamic = "force-dynamic";
// src/app/api/public-site/legal/route.ts
// «Η σελίδα μου» → «Νομικά»: όροι, απόρρητο, cookies (ΕΛ/EN).
// ΜΟΝΟ Διαχειριστής εταιρίας + πακέτο με publicSite (storefrontAccess — ίδιος
// έλεγχος με το withPublicSite), στον server. Η εταιρία ΠΑΝΤΑ από τη συνεδρία.
// Κάθε αποθήκευση = νέα έκδοση (το ιστορικό μένει για τις παλιές κρατήσεις).

import { badRequest, forbidden, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { loadStorefrontAdmin, storefrontAccess } from "@/lib/storefront/admin";
import { legalSaveSchema, missingCompanyFields } from "@/lib/legal/legal";
import { LEGAL_TEMPLATES, TEMPLATE_UPDATED } from "@/lib/legal/templates";
import { loadLegalAdmin, loadLegalCompany, saveLegalText } from "@/lib/legal/legalServer";

async function dto(companyId: string) {
  const [entries, company, site] = await Promise.all([loadLegalAdmin(companyId), loadLegalCompany(companyId), loadStorefrontAdmin(companyId)]);
  return {
    slug: site?.slug ?? null,
    entries,
    templates: LEGAL_TEMPLATES,
    templateUpdated: TEMPLATE_UPDATED,
    company,
    missing: company ? missingCompanyFields(company) : [],
  };
}

// GET /api/public-site/legal
export const GET = withPermission(async (_req, _session, _params, viewer) => {
  try {
    const access = await storefrontAccess(viewer);
    if (!access.ok) return forbidden(access.message);
    return ok(await dto(access.companyId));
  } catch (error) {
    console.error("[FleetPro] public-site legal GET:", error instanceof Error ? error.name : "");
    return serverError();
  }
}, "settings.edit");

// PUT /api/public-site/legal — { kind, lang, body }
export const PUT = withPermission(async (req, session, _params, viewer) => {
  try {
    const access = await storefrontAccess(viewer);
    if (!access.ok) return forbidden(access.message);
    const parsed = legalSaveSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return badRequest(parsed.error.errors[0]?.message ?? "Μη έγκυρα δεδομένα", parsed.error.errors);
    }
    const { kind, lang, body } = parsed.data;
    await saveLegalText(access.companyId, kind, lang, body, session.userId);
    return ok(await dto(access.companyId));
  } catch (error) {
    console.error("[FleetPro] public-site legal PUT:", error instanceof Error ? error.name : "");
    return serverError();
  }
}, "settings.edit");
