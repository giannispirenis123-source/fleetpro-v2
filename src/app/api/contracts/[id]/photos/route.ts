export const dynamic = "force-dynamic";
// src/app/api/contracts/[id]/photos/route.ts
// Φωτογραφίες ζημιών συμβολαίου.
//
// GET  (contracts.view) → οι φωτογραφίες με νέα προσωρινά URLs.
// POST (contracts.edit) → multipart { file, group, note?, takenAt? }.
//
// Παραλαβή: μόνο πριν την πρώτη υπογραφή. Παράδοση: μέχρι την ολοκλήρωση.
// Tenant + στεγανότητα συνεργάτη μέσω contractScope.

import { db } from "@/lib/db";
import { ok, created, badRequest, conflict, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { contractScope } from "@/lib/contractForm";
import { PHOTO_GROUPS, photoLockOf, readDrivers, readPhotos, type PhotoGroup } from "@/lib/contracts";
import { MAX_CONTRACT_PHOTOS } from "@/lib/photoShared";
import {
  StorageError,
  discardPhoto,
  noteFrom,
  readPhotoUpload,
  storageConfigured,
  storageFailed,
  storageUnavailable,
  storePhoto,
  takenAtFrom,
} from "@/lib/photos";
import { mutateContractPhotos, signContractPhotos, toPhotoDTO } from "@/lib/contractPhotos";
import { signUrls } from "@/lib/storage";

// GET /api/contracts/[id]/photos
export const GET = withPermission(
  async (_req, _session, params, viewer) => {
    try {
      const c = await db.contract.findFirst({
        where: { ...contractScope(viewer!), id: params!.id },
        select: { damagePhotos: true },
      });
      if (!c) return notFound("Το συμβόλαιο δεν βρέθηκε");
      return ok({ photos: await signContractPhotos(readPhotos(c.damagePhotos)) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "contracts.view"
);

// POST /api/contracts/[id]/photos
export const POST = withPermission(
  async (req, _session, params, viewer) => {
    try {
      const c = await db.contract.findFirst({
        where: { ...contractScope(viewer!), id: params!.id },
        select: { id: true, tenantId: true, status: true, drivers: true, damagePhotos: true },
      });
      if (!c) return notFound("Το συμβόλαιο δεν βρέθηκε");
      if (!storageConfigured()) return storageUnavailable();

      const read = await readPhotoUpload(req);
      if (!read.ok) return read.response;
      const { upload } = read;

      const groupRaw = String(upload.form.get("group") ?? "");
      if (!(PHOTO_GROUPS as readonly string[]).includes(groupRaw)) {
        return badRequest("Μη έγκυρη ομάδα φωτογραφιών");
      }
      const group = groupRaw as PhotoGroup;

      // Πρώτος έλεγχος πριν ανέβει τίποτα· ξαναγίνεται μέσα στο κλείδωμα.
      if (photoLockOf(group, c.status, readDrivers(c.drivers))) {
        return conflict(
          c.status === "COMPLETED"
            ? "Το συμβόλαιο έχει ολοκληρωθεί και δεν αλλάζει"
            : "Οι φωτογραφίες παραλαβής κλειδώνουν με την πρώτη υπογραφή"
        );
      }
      if (readPhotos(c.damagePhotos).length >= MAX_CONTRACT_PHOTOS) {
        return conflict(`Έως ${MAX_CONTRACT_PHOTOS} φωτογραφίες ανά συμβόλαιο`);
      }

      const stored = await storePhoto(`${c.tenantId}/${c.id}/${group.toLowerCase()}`, upload);
      const photo = {
        id: stored.id,
        path: stored.path,
        group,
        takenAt: takenAtFrom(upload.form),
        note: noteFrom(upload.form),
      };

      let result;
      try {
        result = await mutateContractPhotos(viewer!, c.id, (photos) =>
          photos.length >= MAX_CONTRACT_PHOTOS
            ? { ok: false, status: 409, message: `Έως ${MAX_CONTRACT_PHOTOS} φωτογραφίες ανά συμβόλαιο` }
            : { ok: true, group, photos: [...photos, photo] }
        );
      } catch (error) {
        await discardPhoto(stored.path);
        throw error;
      }
      if (!result.ok) {
        await discardPhoto(stored.path);
        return result.status === 404 ? notFound(result.message) : conflict(result.message);
      }

      const urls = await signUrls([photo.path]);
      return created({ photo: toPhotoDTO(photo, urls.get(photo.path) ?? null) });
    } catch (error) {
      if (error instanceof StorageError) {
        return storageFailed();
      }
      console.error(error);
      return serverError();
    }
  },
  "contracts.edit"
);
