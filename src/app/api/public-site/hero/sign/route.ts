export const dynamic = "force-dynamic";
// src/app/api/public-site/hero/sign/route.ts
// Υπογραφή ανεβάσματος της φωτογραφίας hero — φάκελος fleetpro/{companyId}/site.

import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { signVehicleUpload } from "@/lib/cloudinary";
import { withPublicSite } from "@/lib/public/guard";
import { cloudinaryOrError } from "@/lib/public/photos";
import { sitePhotoFolder } from "@/lib/vehiclePhotos";

// POST /api/public-site/hero/sign
export const POST = withPublicSite(async (_req, companyId) => {
  try {
    const cfg = cloudinaryOrError();
    if ("error" in cfg) return cfg.error;
    const folder = sitePhotoFolder(companyId);
    if (!folder) return serverError();
    return NextResponse.json(
      { success: true, data: signVehicleUpload(cfg.config, folder) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[FleetPro] υπογραφή hero:", error instanceof Error ? error.name : "");
    return serverError();
  }
});
