export const dynamic = "force-dynamic";
// src/app/api/storefront/route.ts
// «Η σελίδα μου»: ρυθμίσεις της δημόσιας σελίδας της εταιρίας.
// ΜΟΝΟ Διαχειριστής + πακέτο με publicSite (storefrontAccess). Η εταιρία
// από τη συνεδρία· το body δεν μπορεί να ορίσει ποια εταιρία αλλάζει.

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, badRequest, forbidden, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { loadStorefrontAdmin, slugOwner, storefrontAccess } from "@/lib/storefront/admin";
import { mergeStorefrontSettings, storefrontUpdateSchema } from "@/lib/storefront/settings";
import { checkSlugAvailability, normalizeSlug } from "@/lib/storefront/slug";

// GET /api/storefront
export const GET = withPermission(
  async (_req, _session, _params, viewer) => {
    try {
      const access = await storefrontAccess(viewer);
      if (!access.ok) return forbidden(access.message);
      const dto = await loadStorefrontAdmin(access.companyId);
      return dto ? ok(dto) : notFound();
    } catch (error) {
      console.error("Storefront GET:", error);
      return serverError();
    }
  },
  "settings.view"
);

// PATCH /api/storefront
export const PATCH = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      const access = await storefrontAccess(viewer);
      if (!access.ok) return forbidden(access.message);

      const parsed = storefrontUpdateSchema.safeParse(await req.json());
      if (!parsed.success) {
        return badRequest(parsed.error.errors[0]?.message ?? "Μη έγκυρα δεδομένα", parsed.error.errors);
      }
      const data = parsed.data;

      const current = await loadStorefrontAdmin(access.companyId);
      if (!current) return notFound();

      let slug = current.slug;
      if (data.slug !== undefined) {
        if (data.slug.trim() === "") {
          slug = null;
        } else {
          const check = checkSlugAvailability(data.slug, await slugOwner(normalizeSlug(data.slug)), access.companyId);
          if (!check.ok) return badRequest(check.message);
          slug = check.slug;
        }
      }

      const enabled = data.enabled ?? current.enabled;
      if (enabled && !slug) {
        return badRequest("Ορίστε πρώτα διεύθυνση (slug) για να ενεργοποιηθεί η σελίδα.");
      }

      const settings = mergeStorefrontSettings(current.settings, data);

      try {
        await db.tenant.update({
          where: { id: access.companyId },
          data: {
            storefrontSlug: slug,
            storefrontEnabled: enabled,
            storefrontSettings: settings as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        // Δύο εταιρίες πήραν το ίδιο slug ταυτόχρονα: το UNIQUE index αποφασίζει.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          return badRequest("Το slug χρησιμοποιείται ήδη από άλλη εταιρία.");
        }
        throw e;
      }

      return ok({ enabled, slug, settings });
    } catch (error) {
      console.error("Storefront PATCH:", error);
      return serverError();
    }
  },
  "settings.edit"
);
