export const dynamic = "force-dynamic";
// src/app/api/public-site/place-photos/[id]/route.ts
// Φωτογραφίες μέρους: POST (αποθήκευση μετά το ανέβασμα) / PATCH (σειρά).
// Ίδια λογική με /api/vehicles/[id]/photos: ο server ελέγχει φάκελο και όριο
// και φτιάχνει μόνος του το URL.

import { z } from "zod";
import { badRequest, conflict, ok, serverError } from "@/lib/api";
import { destroyImage } from "@/lib/cloudinary";
import { withPublicSite } from "@/lib/public/guard";
import { cloudinaryOrError, loadPhotoPlace, syncPlaceCover } from "@/lib/public/photos";
import { appendPhoto, newPhotoId, savePhotoOrder } from "@/lib/vehiclePhotoServer";
import {
  VEHICLE_PHOTO_FORMATS,
  VEHICLE_PHOTO_MSG,
  canAddPhoto,
  cloudinaryImageUrl,
  placePhotoFolder,
  isPublicIdInFolder,
  reorderPhotos,
  toPhotoViews,
} from "@/lib/vehiclePhotos";

const saveSchema = z.object({
  publicId: z.string().min(1).max(255),
  version: z.number().int().positive().max(1e12),
  format: z.string().toLowerCase().pipe(z.enum(VEHICLE_PHOTO_FORMATS)),
});
const orderSchema = z.object({ order: z.array(z.string().max(64)).max(50) });

// POST /api/public-site/place-photos/[id]
export const POST = withPublicSite(async (req, companyId, params) => {
  try {
    const found = await loadPhotoPlace(companyId, params.id);
    if ("error" in found) return found.error;
    const group = found.vehicle; // το μέρος

    const parsed = saveSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(VEHICLE_PHOTO_MSG.badUpload);
    const { publicId, version, format } = parsed.data;

    const folder = placePhotoFolder(companyId, group.id);
    if (!folder || !isPublicIdInFolder(publicId, folder)) return badRequest(VEHICLE_PHOTO_MSG.badUpload);
    const cfg = cloudinaryOrError();
    if ("error" in cfg) return cfg.error;

    const existing = group.photos.find((p) => p.publicId === publicId);
    if (existing) return ok({ photo: { id: existing.id, url: existing.url }, photos: toPhotoViews(group.photos) });

    const photo = {
      id: newPhotoId(),
      url: cloudinaryImageUrl(cfg.config.cloudName, version, publicId, format === "jpeg" ? "jpg" : format),
      publicId,
    };
    const photos = canAddPhoto(group.photos.length) ? await appendPhoto(group, photo) : null;
    if (!photos) {
      await destroyImage(cfg.config, publicId);
      return conflict(VEHICLE_PHOTO_MSG.limit);
    }
    await syncPlaceCover(companyId, group.id, photos);
    return ok({ photo: { id: photo.id, url: photo.url }, photos: toPhotoViews(photos) }, 201);
  } catch (error) {
    console.error("[FleetPro] φωτογραφίες μέρους POST:", error instanceof Error ? error.name : "");
    return serverError();
  }
});

// PATCH /api/public-site/place-photos/[id] — νέα σειρά
export const PATCH = withPublicSite(async (req, companyId, params) => {
  try {
    const found = await loadPhotoPlace(companyId, params.id);
    if ("error" in found) return found.error;
    const parsed = orderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(VEHICLE_PHOTO_MSG.badOrder);
    const next = reorderPhotos(found.vehicle.photos, parsed.data.order);
    if (!next) return conflict(VEHICLE_PHOTO_MSG.changed);
    const saved = await savePhotoOrder(found.vehicle, next);
    if (!saved) return conflict(VEHICLE_PHOTO_MSG.changed);
    await syncPlaceCover(companyId, found.vehicle.id, saved);
    return ok({ photos: toPhotoViews(saved) });
  } catch (error) {
    console.error("[FleetPro] φωτογραφίες μέρους PATCH:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
