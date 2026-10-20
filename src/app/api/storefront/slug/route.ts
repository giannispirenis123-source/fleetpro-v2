export const dynamic = "force-dynamic";
// src/app/api/storefront/slug/route.ts
// GET /api/storefront/slug?slug=… — έλεγχος διαθεσιμότητας για «Η σελίδα μου».
// Ίδιοι κανόνες με το PATCH (checkSlugAvailability). Απαντά μόνο
// «διαθέσιμο / όχι + γιατί» — ποτέ ΠΟΙΑ εταιρία έχει το slug.

import { ok, forbidden, serverError, logError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { slugOwner, storefrontAccess } from "@/lib/storefront/admin";
import { checkSlugAvailability, normalizeSlug, validateSlug } from "@/lib/storefront/slug";

export const GET = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      const access = await storefrontAccess(viewer);
      if (!access.ok) return forbidden(access.message);

      const raw = new URL(req.url).searchParams.get("slug") ?? "";
      const format = validateSlug(raw);
      const check = format.ok
        ? checkSlugAvailability(raw, await slugOwner(normalizeSlug(raw)), access.companyId)
        : format;
      return ok(check.ok ? { available: true, slug: check.slug } : { available: false, message: check.message });
    } catch (error) {
      logError("Storefront slug", error);
      return serverError();
    }
  },
  "settings.edit"
);
