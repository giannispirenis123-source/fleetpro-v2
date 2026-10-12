export const dynamic = "force-dynamic";
// src/app/api/public-site/group-photos/[id]/[photoId]/route.ts
// Διαγραφή φωτογραφίας ομάδας: πρώτα από το Cloudinary, μετά από τη βάση.

import { NextResponse } from "next/server";
import { notFound, ok, serverError } from "@/lib/api";
import { destroyImage } from "@/lib/cloudinary";
import { withPublicSite } from "@/lib/public/guard";
import { cloudinaryOrError, loadPhotoGroup } from "@/lib/public/photos";
import { removePhoto } from "@/lib/vehiclePhotoServer";
import { PHOTO_ID_RE, VEHICLE_PHOTO_MSG, toPhotoViews } from "@/lib/vehiclePhotos";

// DELETE /api/public-site/group-photos/[id]/[photoId]
export const DELETE = withPublicSite(async (_req, companyId, params) => {
  try {
    const found = await loadPhotoGroup(companyId, params.id);
    if ("error" in found) return found.error;
    const photo = PHOTO_ID_RE.test(params.photoId)
      ? found.vehicle.photos.find((p) => p.id === params.photoId)
      : undefined;
    if (!photo) return notFound(VEHICLE_PHOTO_MSG.photoNotFound);
    if (photo.publicId) {
      const cfg = cloudinaryOrError();
      if ("error" in cfg) return cfg.error;
      if (!(await destroyImage(cfg.config, photo.publicId))) {
        return NextResponse.json({ success: false, message: VEHICLE_PHOTO_MSG.deleteFailed }, { status: 502 });
      }
    }
    const photos = await removePhoto(found.vehicle, photo.id);
    return ok({ photos: toPhotoViews(photos) });
  } catch (error) {
    console.error("[FleetPro] διαγραφή φωτογραφίας ομάδας:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
