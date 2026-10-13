export const dynamic = "force-dynamic";
// src/app/api/public-site/hero/[photoId]/route.ts
// Αφαίρεση της φωτογραφίας hero: πρώτα από το Cloudinary, μετά από τις ρυθμίσεις.

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { notFound, ok, serverError } from "@/lib/api";
import { destroyImage } from "@/lib/cloudinary";
import { withPublicSite } from "@/lib/public/guard";
import { cloudinaryOrError } from "@/lib/public/photos";
import { normalizeStorefrontSettings } from "@/lib/storefront/settings";
import { VEHICLE_PHOTO_MSG } from "@/lib/vehiclePhotos";

// DELETE /api/public-site/hero/hero
export const DELETE = withPublicSite(async (_req, companyId) => {
  try {
    const t = await db.tenant.findUnique({ where: { id: companyId }, select: { storefrontSettings: true } });
    if (!t) return notFound();
    const s = normalizeStorefrontSettings(t.storefrontSettings);
    const hero = s.theme.heroImage;
    if (!hero) return notFound(VEHICLE_PHOTO_MSG.photoNotFound);
    if (hero.publicId) {
      const cfg = cloudinaryOrError();
      if ("error" in cfg) return cfg.error;
      if (!(await destroyImage(cfg.config, hero.publicId))) {
        return NextResponse.json({ success: false, message: VEHICLE_PHOTO_MSG.deleteFailed }, { status: 502 });
      }
    }
    await db.tenant.update({
      where: { id: companyId },
      data: { storefrontSettings: { ...s, theme: { ...s.theme, heroImage: null } } as unknown as Prisma.InputJsonValue },
    });
    return ok({ photos: [] });
  } catch (error) {
    console.error("[FleetPro] hero DELETE:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
