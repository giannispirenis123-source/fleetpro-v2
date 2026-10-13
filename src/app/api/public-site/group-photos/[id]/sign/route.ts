export const dynamic = "force-dynamic";
// src/app/api/public-site/group-photos/[id]/sign/route.ts
// Υπογραφή ανεβάσματος φωτογραφίας ομάδας — φάκελος fleetpro/{companyId}/groups/{groupId}.

import { NextResponse } from "next/server";
import { conflict, serverError } from "@/lib/api";
import { signVehicleUpload } from "@/lib/cloudinary";
import { withPublicSite } from "@/lib/public/guard";
import { cloudinaryOrError, loadPhotoGroup } from "@/lib/public/photos";
import { VEHICLE_PHOTO_MSG, canAddPhoto, groupPhotoFolder } from "@/lib/vehiclePhotos";

// POST /api/public-site/group-photos/[id]/sign
export const POST = withPublicSite(async (_req, companyId, params) => {
  try {
    const found = await loadPhotoGroup(companyId, params.id);
    if ("error" in found) return found.error;
    if (!canAddPhoto(found.vehicle.photos.length)) return conflict(VEHICLE_PHOTO_MSG.limit);
    const cfg = cloudinaryOrError();
    if ("error" in cfg) return cfg.error;
    const folder = groupPhotoFolder(companyId, found.vehicle.id);
    if (!folder) return serverError();
    return NextResponse.json(
      { success: true, data: signVehicleUpload(cfg.config, folder) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[FleetPro] υπογραφή φωτογραφίας ομάδας:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
