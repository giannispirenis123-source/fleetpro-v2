// src/lib/vehiclePhotoServer.ts
// Φωτογραφίες οχήματος — κοινά των API routes (server-only).
//
// Κάθε ερώτημα φιλτράρει ΚΑΙ με tenantId από τη βάση (viewer): το id του
// οχήματος μόνο του δεν αρκεί. Οι αλλαγές στη στήλη "photos" γίνονται με
// raw SQL, ατομικά (όριο 10 / αφαίρεση / σειρά στο ίδιο UPDATE).

import { randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { forbidden, notFound } from "./api";
import type { Viewer } from "./authz";
import { ADMIN_ROLE } from "./adminRole";
import { cloudinaryConfig, destroyImage } from "./cloudinary";
import {
  MAX_VEHICLE_PHOTOS,
  VEHICLE_PHOTO_MSG,
  readVehiclePhotos,
  type VehiclePhoto,
} from "./vehiclePhotos";

export interface PhotoVehicle {
  id: string;
  tenantId: string;
  photos: VehiclePhoto[];
  /** Η στήλη όπως διαβάστηκε (για τον έλεγχο «άλλαξε στο μεταξύ»). */
  raw: unknown;
}

/** Το όχημα της ΙΔΙΑΣ εταιρίας (ενεργό) — ή απάντηση σφάλματος. */
export async function loadPhotoVehicle(
  viewer: Viewer,
  vehicleId: string,
  { adminOnly }: { adminOnly: boolean }
): Promise<{ vehicle: PhotoVehicle } | { error: NextResponse }> {
  if (adminOnly && viewer.role !== ADMIN_ROLE) return { error: forbidden(VEHICLE_PHOTO_MSG.adminOnly) };
  if (!viewer.tenantId) return { error: forbidden() };
  const v = await db.vehicle.findFirst({
    where: { id: vehicleId, tenantId: viewer.tenantId, isActive: true },
    select: { id: true, tenantId: true, photos: true },
  });
  if (!v) return { error: notFound(VEHICLE_PHOTO_MSG.notFound) };
  return { vehicle: { id: v.id, tenantId: v.tenantId, photos: readVehiclePhotos(v.photos), raw: v.photos } };
}

export const newPhotoId = () => randomBytes(12).toString("base64url");

/**
 * Προσθήκη στο τέλος, ΜΟΝΟ αν χωρά (ο έλεγχος του ορίου στο ίδιο UPDATE).
 * null = γέμισε στο μεταξύ.
 */
export async function appendPhoto(
  vehicle: PhotoVehicle,
  photo: Omit<VehiclePhoto, "order">
): Promise<VehiclePhoto[] | null> {
  const rows = await db.$queryRaw<{ photos: unknown }[]>(Prisma.sql`
    UPDATE "vehicles"
    SET "photos" = "photos" || jsonb_build_array(jsonb_build_object(
      'id', ${photo.id}::text, 'url', ${photo.url}::text, 'publicId', ${photo.publicId}::text,
      'order', jsonb_array_length("photos")))
    WHERE "id" = ${vehicle.id} AND "tenantId" = ${vehicle.tenantId}
      AND jsonb_array_length("photos") < ${MAX_VEHICLE_PHOTOS}
    RETURNING "photos"
  `);
  return rows.length > 0 ? readVehiclePhotos(rows[0].photos) : null;
}

/** Αφαίρεση μίας και επαναρίθμηση (0, 1, 2, …). */
export async function removePhoto(vehicle: PhotoVehicle, photoId: string): Promise<VehiclePhoto[]> {
  const rows = await db.$queryRaw<{ photos: unknown }[]>(Prisma.sql`
    UPDATE "vehicles"
    SET "photos" = COALESCE((
      SELECT jsonb_agg(s.e || jsonb_build_object('order', s.rn - 1) ORDER BY s.rn)
      FROM (
        SELECT e, row_number() OVER (ORDER BY (e->>'order')::numeric NULLS LAST, n) AS rn
        FROM jsonb_array_elements("photos") WITH ORDINALITY AS t(e, n)
        WHERE e->>'id' IS DISTINCT FROM ${photoId}
      ) s
    ), '[]'::jsonb)
    WHERE "id" = ${vehicle.id} AND "tenantId" = ${vehicle.tenantId}
    RETURNING "photos"
  `);
  return readVehiclePhotos(rows[0]?.photos);
}

/**
 * Νέα σειρά — μόνο αν η στήλη είναι ακόμη ΑΚΡΙΒΩΣ όπως τη διαβάσαμε
 * (αλλιώς null: κάποιος πρόσθεσε/έσβησε στο μεταξύ).
 */
export async function savePhotoOrder(
  vehicle: PhotoVehicle,
  next: VehiclePhoto[]
): Promise<VehiclePhoto[] | null> {
  const rows = await db.$queryRaw<{ photos: unknown }[]>(Prisma.sql`
    UPDATE "vehicles"
    SET "photos" = ${JSON.stringify(next)}::jsonb
    WHERE "id" = ${vehicle.id} AND "tenantId" = ${vehicle.tenantId}
      AND "photos" = ${JSON.stringify(vehicle.raw ?? [])}::jsonb
    RETURNING "photos"
  `);
  return rows.length > 0 ? readVehiclePhotos(rows[0].photos) : null;
}

/**
 * Διαγραφή ΟΛΩΝ των φωτογραφιών ενός οχήματος από το Cloudinary (στη
 * διαγραφή οχήματος). Επιστρέφει όσες ΔΕΝ σβήστηκαν, ώστε να μείνουν
 * καταγεγραμμένες (καμία «ορφανή» εικόνα χωρίς ίχνος).
 */
export async function destroyAllPhotos(photos: VehiclePhoto[]): Promise<VehiclePhoto[]> {
  const withId = photos.filter((p) => p.publicId);
  if (withId.length === 0) return [];
  const cfg = cloudinaryConfig();
  if (!cfg.ok) {
    console.error(`[FleetPro] Cloudinary: λείπουν ${cfg.missing.join(", ")} — οι φωτογραφίες του οχήματος έμειναν`);
    return withId;
  }
  const kept: VehiclePhoto[] = [];
  for (const p of withId) {
    if (!(await destroyImage(cfg.config, p.publicId!))) kept.push(p);
  }
  return kept.map((p, order) => ({ ...p, order }));
}
