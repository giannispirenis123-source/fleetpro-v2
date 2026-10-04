export const dynamic = "force-dynamic";
// src/app/api/damages/[id]/photos/route.ts
// Φωτογραφίες ζημιάς: GET (damages.view) με προσωρινά URLs, POST
// (damages.edit) multipart { file }. Ίδιος κώδικας με τα συμβόλαια.

import { ok, created, conflict, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { MAX_DAMAGE_PHOTOS } from "@/lib/photoShared";
import {
  StorageError,
  discardPhoto,
  readPhotoUpload,
  storageConfigured,
  storageFailed,
  storageUnavailable,
  storePhoto,
} from "@/lib/photos";
import { appendDamagePhoto, findDamage, signDamagePhotos } from "@/lib/damagePhotos";

// GET /api/damages/[id]/photos
export const GET = withPermission(
  async (_req, session, params) => {
    try {
      const damage = await findDamage(session.tenantId!, params!.id);
      if (!damage) return notFound("Η ζημιά δεν βρέθηκε");
      return ok({ photos: await signDamagePhotos(damage.photos) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "damages.view"
);

// POST /api/damages/[id]/photos
export const POST = withPermission(
  async (req, session, params) => {
    try {
      const damage = await findDamage(session.tenantId!, params!.id);
      if (!damage) return notFound("Η ζημιά δεν βρέθηκε");
      if (!storageConfigured()) return storageUnavailable();
      if (damage.photos.length >= MAX_DAMAGE_PHOTOS) {
        return conflict(`Έως ${MAX_DAMAGE_PHOTOS} φωτογραφίες ανά ζημιά`);
      }

      const read = await readPhotoUpload(req);
      if (!read.ok) return read.response;

      const stored = await storePhoto(`${damage.tenantId}/damages/${damage.id}`, read.upload);
      let added = false;
      try {
        added = await appendDamagePhoto(damage.tenantId, damage.id, stored.path);
      } finally {
        if (!added) await discardPhoto(stored.path);
      }
      if (!added) return conflict(`Έως ${MAX_DAMAGE_PHOTOS} φωτογραφίες ανά ζημιά`);

      const [photo] = await signDamagePhotos([stored.path]);
      return created({ photo });
    } catch (error) {
      if (error instanceof StorageError) return storageFailed();
      console.error(error);
      return serverError();
    }
  },
  "damages.edit"
);
