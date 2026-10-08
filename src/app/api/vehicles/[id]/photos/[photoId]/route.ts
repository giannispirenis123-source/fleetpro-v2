export const dynamic = "force-dynamic";
// src/app/api/vehicles/[id]/photos/[photoId]/route.ts
// Διαγραφή μίας φωτογραφίας οχήματος: πρώτα από το Cloudinary, μετά από τη
// βάση (αν αποτύχει το Cloudinary, η φωτογραφία μένει — καμία ορφανή εικόνα).
// Μόνο Διαχειριστής, μόνο όχημα της εταιρίας του.

import { NextResponse } from "next/server";
import { notFound, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { cloudinaryConfig, destroyImage } from "@/lib/cloudinary";
import { loadPhotoVehicle, removePhoto } from "@/lib/vehiclePhotoServer";
import { PHOTO_ID_RE, VEHICLE_PHOTO_MSG, toPhotoViews } from "@/lib/vehiclePhotos";

// DELETE /api/vehicles/[id]/photos/[photoId]
export const DELETE = withPermission(
  async (_req, _session, params, viewer) => {
    try {
      const found = await loadPhotoVehicle(viewer!, params!.id, { adminOnly: true });
      if ("error" in found) return found.error;
      const { vehicle } = found;

      const photoId = params!.photoId;
      const photo = PHOTO_ID_RE.test(photoId) ? vehicle.photos.find((p) => p.id === photoId) : undefined;
      if (!photo) return notFound(VEHICLE_PHOTO_MSG.photoNotFound);

      if (photo.publicId) {
        const cfg = cloudinaryConfig();
        if (!cfg.ok) {
          console.error(`[FleetPro] Cloudinary: λείπουν ${cfg.missing.join(", ")}`);
          return NextResponse.json({ success: false, message: VEHICLE_PHOTO_MSG.notConfigured }, { status: 503 });
        }
        if (!(await destroyImage(cfg.config, photo.publicId))) {
          return NextResponse.json({ success: false, message: VEHICLE_PHOTO_MSG.deleteFailed }, { status: 502 });
        }
      }

      const photos = await removePhoto(vehicle, photo.id);
      return ok({ photos: toPhotoViews(photos) });
    } catch (error) {
      console.error("[FleetPro] διαγραφή φωτογραφίας οχήματος: σφάλμα", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "fleet.edit"
);
