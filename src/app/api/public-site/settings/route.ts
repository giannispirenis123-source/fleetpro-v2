export const dynamic = "force-dynamic";
// src/app/api/public-site/settings/route.ts
// Ρυθμίσεις κρατήσεων / επικοινωνίας / εμφάνισης / εμπιστοσύνης του site.
// · Αποθηκεύονται στο υπάρχον tenants."storefrontSettings" (καμία νέα στήλη).
// · Ο τρόπος κράτησης γράφεται στο tenants."rentalMode" — ΤΟ ΙΔΙΟ πεδίο με
//   τις Ρυθμίσεις του dashboard (μία πηγή αλήθειας).
// · ΦΠΑ, κύριο χρώμα και λογότυπο μόνο για ανάγνωση (ζουν αλλού).

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { badRequest, notFound, ok, serverError } from "@/lib/api";
import { withPublicSite } from "@/lib/public/guard";
import { siteSettingsUpdateSchema } from "@/lib/public/siteSettings";
import { mergeSiteSettings, normalizeStorefrontSettings } from "@/lib/storefront/settings";
import { signUrls } from "@/lib/storage";
import { hasModule } from "@/lib/entitlements";
import { HIDDEN_REASON_TEXT, storefrontVisibility } from "@/lib/storefront/visibility";

const SELECT = {
  rentalMode: true,
  vatRate: true,
  brandColor: true,
  logoPath: true,
  storefrontSettings: true,
  storefrontSlug: true,
  storefrontEnabled: true,
  status: true,
} as const;

async function toDTO(t: Prisma.TenantGetPayload<{ select: typeof SELECT }>, companyId: string) {
  const s = normalizeStorefrontSettings(t.storefrontSettings);
  // Ο ΙΔΙΟΣ κανόνας με το δημόσιο site (visibility.ts) — εδώ με τον λόγο,
  // γιατί τον βλέπει μόνο ο Διαχειριστής.
  const visibility = storefrontVisibility({
    storefrontSlug: t.storefrontSlug,
    storefrontEnabled: t.storefrontEnabled,
    status: t.status,
    publicSite: await hasModule(companyId, "publicSite"),
  });
  const logoUrl = t.logoPath ? ((await signUrls([t.logoPath])).get(t.logoPath) ?? null) : null;
  return {
    rentalMode: t.rentalMode,
    vatRate: Number(t.vatRate),
    brandColor: t.brandColor,
    logoUrl,
    payOnPickup: s.paymentOptions.onPickup,
    booking: s.booking,
    contact: s.contact,
    theme: { ...s.theme, heroImage: s.theme.heroImage ? { url: s.theme.heroImage.url } : null },
    trustBlocks: s.trustBlocks,
    site: {
      slug: t.storefrontSlug,
      languages: s.supportedLanguages,
      defaultLanguage: s.defaultLanguage,
      open: visibility.open,
      reason: visibility.open ? null : HIDDEN_REASON_TEXT[visibility.reason].el,
    },
  };
}

// GET /api/public-site/settings
export const GET = withPublicSite(async (_req, companyId) => {
  try {
    const t = await db.tenant.findUnique({ where: { id: companyId }, select: SELECT });
    return t ? ok(await toDTO(t, companyId)) : notFound();
  } catch (error) {
    console.error("[FleetPro] public-site settings GET:", error instanceof Error ? error.name : "");
    return serverError();
  }
});

// PATCH /api/public-site/settings — μόνο οι ενότητες που στάλθηκαν
export const PATCH = withPublicSite(async (req, companyId) => {
  try {
    const parsed = siteSettingsUpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return badRequest(parsed.error.errors[0]?.message ?? "Μη έγκυρα δεδομένα", parsed.error.errors);
    }
    const update = parsed.data;

    const saved = await db.$transaction(async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: companyId }, select: { storefrontSettings: true } });
      if (!t) return null;
      const next = mergeSiteSettings(normalizeStorefrontSettings(t.storefrontSettings), update);
      return tx.tenant.update({
        where: { id: companyId },
        data: {
          storefrontSettings: next as unknown as Prisma.InputJsonValue,
          ...(update.rentalMode && { rentalMode: update.rentalMode }),
        },
        select: SELECT,
      });
    });
    return saved ? ok(await toDTO(saved, companyId)) : notFound();
  } catch (error) {
    console.error("[FleetPro] public-site settings PATCH:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
