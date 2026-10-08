export const dynamic = "force-dynamic";
// src/app/api/vehicles/[id]/photos/route.ts
// Φωτογραφίες οχήματος (Cloudinary).
//
// GET   → { photos }                                όλοι με «Προβολή στόλου»
// POST  { publicId, version, format } → { photo, photos }   μόνο Διαχειριστής
//       (μετά το ανέβασμα στο Cloudinary: ο server ελέγχει τον φάκελο, φτιάχνει
//        ο ίδιος το URL και ξαναελέγχει το όριο 10 στο ίδιο UPDATE)
// PATCH { order: string[] } → { photos }            μόνο Διαχειριστής

import { z } from "zod";
import { badRequest, conflict, ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { cloudinaryConfig, destroyImage } from "@/lib/cloudinary";
import {
  appendPhoto,
  loadPhotoVehicle,
  newPhotoId,
  savePhotoOrder,
} from "@/lib/vehiclePhotoServer";
import {
  VEHICLE_PHOTO_FORMATS,
  VEHICLE_PHOTO_MSG,
  canAddPhoto,
  cloudinaryImageUrl,
  isPublicIdInFolder,
  reorderPhotos,
  toPhotoViews,
  vehiclePhotoFolder,
} from "@/lib/vehiclePhotos";

const saveSchema = z.object({
  publicId: z.string().min(1).max(255),
  version: z.number().int().positive().max(1e12),
  format: z.string().toLowerCase().pipe(z.enum(VEHICLE_PHOTO_FORMATS)),
});

const orderSchema = z.object({ order: z.array(z.string().max(64)).max(50) });

const logError = (what: string, error: unknown) =>
  console.error(`[FleetPro] φωτογραφίες οχήματος (${what}): σφάλμα`, error instanceof Error ? error.name : "");

// GET /api/vehicles/[id]/photos
export const GET = withPermission(
  async (_req, _session, params, viewer) => {
    try {
      const found = await loadPhotoVehicle(viewer!, params!.id, { adminOnly: false });
      if ("error" in found) return found.error;
      return ok({ photos: toPhotoViews(found.vehicle.photos) });
    } catch (error) {
      logError("GET", error);
      return serverError();
    }
  },
  "fleet.view"
);

// POST /api/vehicles/[id]/photos
export const POST = withPermission(
  async (req, _session, params, viewer) => {
    try {
      const found = await loadPhotoVehicle(viewer!, params!.id, { adminOnly: true });
      if ("error" in found) return found.error;
      const { vehicle } = found;

      const raw = await req.json().catch(() => null);
      const parsed = saveSchema.safeParse(raw);
      if (!parsed.success) {
        const badFormat = raw && typeof raw === "object" && "format" in raw && !parsed.error.errors.some((e) => e.path[0] !== "format");
        return badRequest(badFormat ? VEHICLE_PHOTO_MSG.badType : VEHICLE_PHOTO_MSG.badUpload);
      }
      const { publicId, version, format } = parsed.data;

      const folder = vehiclePhotoFolder(vehicle.tenantId, vehicle.id);
      // Μόνο εικόνα μέσα στον φάκελο ΑΥΤΟΥ του οχήματος ΑΥΤΗΣ της εταιρίας.
      if (!folder || !isPublicIdInFolder(publicId, folder)) return badRequest(VEHICLE_PHOTO_MSG.badUpload);

      const cfg = cloudinaryConfig();
      if (!cfg.ok) {
        console.error(`[FleetPro] Cloudinary: λείπουν ${cfg.missing.join(", ")}`);
        return serverError(VEHICLE_PHOTO_MSG.notConfigured);
      }

      // Ήδη αποθηκευμένη (διπλό αίτημα) → η ίδια απάντηση.
      const existing = vehicle.photos.find((p) => p.publicId === publicId);
      if (existing) return ok({ photo: { id: existing.id, url: existing.url }, photos: toPhotoViews(vehicle.photos) });

      const photo = {
        id: newPhotoId(),
        url: cloudinaryImageUrl(cfg.config.cloudName, version, publicId, format === "jpeg" ? "jpg" : format),
        publicId,
      };
      const photos = canAddPhoto(vehicle.photos.length) ? await appendPhoto(vehicle, photo) : null;
      if (!photos) {
        // Γέμισε στο μεταξύ: η εικόνα δεν κρατιέται ούτε στο Cloudinary.
        await destroyImage(cfg.config, publicId);
        return conflict(VEHICLE_PHOTO_MSG.limit);
      }
      return ok({ photo: { id: photo.id, url: photo.url }, photos: toPhotoViews(photos) }, 201);
    } catch (error) {
      logError("POST", error);
      return serverError();
    }
  },
  "fleet.edit"
);

// PATCH /api/vehicles/[id]/photos — νέα σειρά (η πρώτη γίνεται κύρια)
export const PATCH = withPermission(
  async (req, _session, params, viewer) => {
    try {
      const found = await loadPhotoVehicle(viewer!, params!.id, { adminOnly: true });
      if ("error" in found) return found.error;
      const { vehicle } = found;

      const parsed = orderSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return badRequest(VEHICLE_PHOTO_MSG.badOrder);

      const next = reorderPhotos(vehicle.photos, parsed.data.order);
      if (!next) return conflict(VEHICLE_PHOTO_MSG.changed);

      const saved = await savePhotoOrder(vehicle, next);
      if (!saved) return conflict(VEHICLE_PHOTO_MSG.changed);
      return ok({ photos: toPhotoViews(saved) });
    } catch (error) {
      logError("PATCH", error);
      return serverError();
    }
  },
  "fleet.edit"
);
