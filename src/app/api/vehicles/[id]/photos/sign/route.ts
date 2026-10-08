export const dynamic = "force-dynamic";
// src/app/api/vehicles/[id]/photos/sign/route.ts
// Υπογραφή για ανέβασμα φωτογραφίας οχήματος ΑΠΕΥΘΕΙΑΣ από τον browser στο
// Cloudinary (signed upload). Το API secret δεν φεύγει ποτέ από τον server.
//
// POST → { cloudName, apiKey, timestamp, folder, allowedFormats, signature, uploadUrl }
// Μόνο Διαχειριστής, μόνο όχημα της εταιρίας του, μόνο αν χωρά (όριο 10).

import { NextResponse } from "next/server";
import { conflict, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { cloudinaryConfig, signVehicleUpload } from "@/lib/cloudinary";
import { loadPhotoVehicle } from "@/lib/vehiclePhotoServer";
import { VEHICLE_PHOTO_MSG, canAddPhoto, vehiclePhotoFolder } from "@/lib/vehiclePhotos";

// POST /api/vehicles/[id]/photos/sign
export const POST = withPermission(
  async (_req, _session, params, viewer) => {
    try {
      const found = await loadPhotoVehicle(viewer!, params!.id, { adminOnly: true });
      if ("error" in found) return found.error;
      const { vehicle } = found;

      if (!canAddPhoto(vehicle.photos.length)) return conflict(VEHICLE_PHOTO_MSG.limit);

      const cfg = cloudinaryConfig();
      if (!cfg.ok) {
        console.error(`[FleetPro] Cloudinary: λείπουν ${cfg.missing.join(", ")}`);
        return NextResponse.json({ success: false, message: VEHICLE_PHOTO_MSG.notConfigured }, { status: 503 });
      }

      const folder = vehiclePhotoFolder(vehicle.tenantId, vehicle.id);
      if (!folder) return serverError();

      return NextResponse.json(
        { success: true, data: signVehicleUpload(cfg.config, folder) },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (error) {
      console.error("[FleetPro] υπογραφή φωτογραφίας οχήματος: σφάλμα", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "fleet.edit"
);
