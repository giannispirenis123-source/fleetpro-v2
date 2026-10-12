// src/lib/public/photos.ts
// Φωτογραφίες του δημόσιου site (ομάδες + hero) — ΜΟΝΟ server.
// ΙΔΙΟΙ κανόνες με τα οχήματα (signed upload στο Cloudinary, έλεγχος φακέλου,
// όριο 10, διαγραφή και από το Cloudinary): ξαναχρησιμοποιεί το
// vehiclePhotoServer με πίνακα "rental_groups".

import { NextResponse } from "next/server";
import { db } from "../db";
import { notFound } from "../api";
import { cloudinaryConfig, destroyImage, type CloudinaryConfig } from "../cloudinary";
import { readVehiclePhotos, VEHICLE_PHOTO_MSG, type VehiclePhoto } from "../vehiclePhotos";
import type { PhotoVehicle } from "../vehiclePhotoServer";

/** Hero: οριζόντια, τουλάχιστον τόσο πλάτος (px). */
export const HERO_MIN_WIDTH = 1600;

export const SITE_PHOTO_MSG = {
  groupNotFound: "Η ομάδα δεν βρέθηκε",
  heroSize: "Η φωτογραφία πρέπει να είναι οριζόντια και τουλάχιστον 1600px πλάτος.",
} as const;

/** Η ομάδα της ΙΔΙΑΣ εταιρίας, σε μορφή που καταλαβαίνει το vehiclePhotoServer. */
export async function loadPhotoGroup(
  companyId: string,
  groupId: string
): Promise<{ vehicle: PhotoVehicle } | { error: NextResponse }> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(groupId)) return { error: notFound(SITE_PHOTO_MSG.groupNotFound) };
  const g = await db.rentalGroup.findFirst({
    where: { id: groupId, tenantId: companyId },
    select: { id: true, tenantId: true, photos: true },
  });
  if (!g) return { error: notFound(SITE_PHOTO_MSG.groupNotFound) };
  return {
    vehicle: { id: g.id, tenantId: g.tenantId, table: "rental_groups", photos: readVehiclePhotos(g.photos), raw: g.photos },
  };
}

/** 503 όταν λείπουν οι μεταβλητές του Cloudinary (ίδιο μήνυμα με τα οχήματα). */
export function cloudinaryOrError(): { error: NextResponse } | { config: CloudinaryConfig } {
  const cfg = cloudinaryConfig();
  if (!cfg.ok) {
    console.error(`[FleetPro] Cloudinary: λείπουν ${cfg.missing.join(", ")}`);
    return { error: NextResponse.json({ success: false, message: VEHICLE_PHOTO_MSG.notConfigured }, { status: 503 }) };
  }
  return { config: cfg.config };
}

/** Σβήνει όλες τις φωτογραφίες από το Cloudinary· true αν σβήστηκαν όλες. */
export async function destroyPhotos(photos: VehiclePhoto[]): Promise<boolean> {
  const withId = photos.filter((p) => p.publicId);
  if (withId.length === 0) return true;
  const cfg = cloudinaryConfig();
  if (!cfg.ok) return false;
  let all = true;
  for (const p of withId) if (!(await destroyImage(cfg.config, p.publicId!))) all = false;
  return all;
}
