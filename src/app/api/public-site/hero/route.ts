export const dynamic = "force-dynamic";
// src/app/api/public-site/hero/route.ts
// Η ΜΙΑ φωτογραφία hero του site → storefrontSettings.theme.heroImage.
// POST μετά το ανέβασμα στο Cloudinary: ο server ελέγχει φάκελο και διαστάσεις
// (οριζόντια, ≥ 1600px), φτιάχνει το URL και σβήνει την προηγούμενη.

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { badRequest, notFound, ok, serverError } from "@/lib/api";
import { destroyImage } from "@/lib/cloudinary";
import { withPublicSite } from "@/lib/public/guard";
import { HERO_MIN_WIDTH, SITE_PHOTO_MSG, cloudinaryOrError } from "@/lib/public/photos";
import { normalizeStorefrontSettings } from "@/lib/storefront/settings";
import {
  VEHICLE_PHOTO_FORMATS,
  VEHICLE_PHOTO_MSG,
  cloudinaryImageUrl,
  isPublicIdInFolder,
  sitePhotoFolder,
} from "@/lib/vehiclePhotos";

const saveSchema = z.object({
  publicId: z.string().min(1).max(255),
  version: z.number().int().positive().max(1e12),
  format: z.string().toLowerCase().pipe(z.enum(VEHICLE_PHOTO_FORMATS)),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

// POST /api/public-site/hero
export const POST = withPublicSite(async (req, companyId) => {
  try {
    const parsed = saveSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(VEHICLE_PHOTO_MSG.badUpload);
    const { publicId, version, format, width, height } = parsed.data;
    const folder = sitePhotoFolder(companyId);
    if (!folder || !isPublicIdInFolder(publicId, folder)) return badRequest(VEHICLE_PHOTO_MSG.badUpload);
    const cfg = cloudinaryOrError();
    if ("error" in cfg) return cfg.error;
    if (width < HERO_MIN_WIDTH || width <= height) {
      await destroyImage(cfg.config, publicId);
      return badRequest(SITE_PHOTO_MSG.heroSize);
    }

    const url = cloudinaryImageUrl(cfg.config.cloudName, version, publicId, format === "jpeg" ? "jpg" : format);
    const previous = await db.$transaction(async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: companyId }, select: { storefrontSettings: true } });
      if (!t) return undefined;
      const s = normalizeStorefrontSettings(t.storefrontSettings);
      const old = s.theme.heroImage;
      const next = { ...s, theme: { ...s.theme, heroImage: { url, publicId } } };
      await tx.tenant.update({
        where: { id: companyId },
        data: { storefrontSettings: next as unknown as Prisma.InputJsonValue },
      });
      return old;
    });
    if (previous === undefined) return notFound();
    if (previous?.publicId && previous.publicId !== publicId) await destroyImage(cfg.config, previous.publicId);
    return ok({ photo: { id: "hero", url } }, 201);
  } catch (error) {
    console.error("[FleetPro] hero POST:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
