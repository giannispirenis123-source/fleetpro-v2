export const dynamic = "force-dynamic";
// src/app/api/contracts/[id]/licenses/route.ts
// Φωτογραφίες διπλώματος ανά οδηγό (έως MAX_LICENSE_PHOTOS) — ΜΟΝΟ εσωτερικά.
//
// POST   (contracts.edit) → multipart { file, driverId }: προσθήκη, μέχρι την
//        ολοκλήρωση (και μετά τις υπογραφές).
// DELETE (contracts.edit) → ?driverId=&photoId=: μόνο πριν την πρώτη υπογραφή.
//
// Διαδρομή: tenantId/contractId/licenses/<driverId>-<τυχαίο>.jpg (τα παλιά
// <driverId>-<front|back>-<τυχαίο>.jpg διαβάζονται κανονικά).
// Tenant + στεγανότητα συνεργάτη μέσω contractScope (findScopedContract).
// Η απάντηση δίνει ΜΟΝΟ σύντομο signed URL — ποτέ τη διαδρομή.

import { NextRequest } from "next/server";
import { ok, created, badRequest, conflict, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { MAX_LICENSE_PHOTOS, licenseLockOf, readDrivers } from "@/lib/contracts";
import { PUBLIC_SIGNED_URL_SECONDS } from "@/lib/contractLink";
import { PHOTO_ID_RE, photoIdOf } from "@/lib/photoShared";
import {
  StorageError,
  discardPhoto,
  readPhotoUpload,
  storageErrorResponse,
  storageProblemResponse,
  storePhoto,
} from "@/lib/photos";
import { mutateLicensePhotos } from "@/lib/contractPhotos";
import { removeObjects, signUrls } from "@/lib/storage";
import { db } from "@/lib/db";
import { contractScope } from "@/lib/contractForm";

const DRIVER_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

const fail = (r: { status: 404 | 409; message: string }) =>
  r.status === 404 ? notFound(r.message) : conflict(r.message);

// POST /api/contracts/[id]/licenses
export const POST = withPermission(
  async (req, _session, params, viewer) => {
    try {
      const c = await db.contract.findFirst({
        where: { ...contractScope(viewer!), id: params!.id },
        select: { id: true, tenantId: true, status: true, drivers: true },
      });
      if (!c) return notFound("Το συμβόλαιο δεν βρέθηκε");
      const misconfigured = storageProblemResponse();
      if (misconfigured) return misconfigured;

      const read = await readPhotoUpload(req);
      if (!read.ok) return read.response;
      const { upload } = read;

      const driverId = String(upload.form.get("driverId") ?? "");
      if (!DRIVER_ID_RE.test(driverId)) return badRequest("Μη έγκυρα δεδομένα");

      // Πρώτος έλεγχος πριν ανέβει τίποτα· ξαναγίνεται μέσα στο κλείδωμα.
      const drivers = readDrivers(c.drivers);
      if (licenseLockOf("upload", c.status, drivers)) {
        return conflict("Το συμβόλαιο έχει ολοκληρωθεί και δεν αλλάζει");
      }
      const driver = drivers.find((d) => d.id === driverId);
      if (!driver) {
        return notFound("Ο οδηγός δεν βρέθηκε — αποθήκευσε πρώτα το συμβόλαιο");
      }
      if ((driver.licensePhotos?.length ?? 0) >= MAX_LICENSE_PHOTOS) {
        return conflict(`Έως ${MAX_LICENSE_PHOTOS} φωτογραφίες διπλώματος ανά οδηγό`);
      }

      const stored = await storePhoto(`${c.tenantId}/${c.id}/licenses`, upload, `${driverId}-`);

      let result;
      try {
        result = await mutateLicensePhotos(viewer!, c.id, driverId, { add: stored.path });
      } catch (error) {
        await discardPhoto(stored.path);
        throw error;
      }
      if (!result.ok) {
        await discardPhoto(stored.path);
        return fail(result);
      }

      const urls = await signUrls([stored.path], PUBLIC_SIGNED_URL_SECONDS);
      return created({
        photo: {
          driverId,
          id: photoIdOf(stored.path),
          url: urls.get(stored.path) ?? null,
          takenAt: null,
          note: "",
        },
      });
    } catch (error) {
      if (error instanceof StorageError) return storageErrorResponse(error);
      console.error(error);
      return serverError();
    }
  },
  "contracts.edit"
);

// DELETE /api/contracts/[id]/licenses?driverId=&photoId=
export const DELETE = withPermission(
  async (req: NextRequest, _session, params, viewer) => {
    try {
      const sp = req.nextUrl.searchParams;
      const driverId = sp.get("driverId") ?? "";
      const photoId = sp.get("photoId") ?? "";
      if (!DRIVER_ID_RE.test(driverId) || !PHOTO_ID_RE.test(photoId)) {
        return badRequest("Μη έγκυρα δεδομένα");
      }

      const result = await mutateLicensePhotos(viewer!, params!.id, driverId, { removeId: photoId });
      if (!result.ok) return fail(result);
      // Πρώτα η βάση, μετά το αρχείο.
      if (result.removed) await removeObjects([result.removed]);
      return ok({ driverId, photoId });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "contracts.edit"
);
