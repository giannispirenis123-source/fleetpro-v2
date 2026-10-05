export const dynamic = "force-dynamic";
// src/app/api/settings/logo/route.ts
// Λογότυπο εταιρίας (settings.edit — ίδιος έλεγχος με τις υπόλοιπες Ρυθμίσεις).
//
// POST   multipart { file } → JPEG/PNG/WebP (όχι SVG: ο τύπος ελέγχεται από
//        τα πρώτα bytes). Διαδρομή tenantId/branding/logo-<τυχαίο>.<ext>.
//        Στην αλλαγή σβήνεται το παλιό αρχείο από το Storage.
// DELETE → αφαίρεση (βάση πρώτα, μετά το αρχείο).
// Το tenantId πάντα από το session.

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, created, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import {
  StorageError,
  discardPhoto,
  readPhotoUpload,
  storageErrorResponse,
  storageProblemResponse,
  storePhoto,
} from "@/lib/photos";
import { removeObjects, signUrls } from "@/lib/storage";

/**
 * Αλλάζει το logoPath ατομικά (FOR UPDATE) και επιστρέφει το παλιό, ώστε
 * δύο ταυτόχρονες αλλαγές να μην αφήνουν ορφανά αρχεία.
 */
async function swapLogo(tenantId: string, path: string | null) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ logoPath: string | null }[]>(Prisma.sql`
      SELECT "logoPath" FROM "tenants" WHERE "id" = ${tenantId} FOR UPDATE
    `);
    if (!rows[0]) return { found: false as const, previous: null };
    await tx.tenant.update({ where: { id: tenantId }, data: { logoPath: path } });
    return { found: true as const, previous: rows[0].logoPath };
  });
}

// POST /api/settings/logo
export const POST = withPermission(
  async (req, session) => {
    try {
      const tenantId = session.tenantId;
      if (!tenantId) return notFound("Η εταιρία δεν βρέθηκε");
      const misconfigured = storageProblemResponse();
      if (misconfigured) return misconfigured;

      const read = await readPhotoUpload(req);
      if (!read.ok) return read.response;

      const stored = await storePhoto(`${tenantId}/branding`, read.upload, "logo-");
      let swap;
      try {
        swap = await swapLogo(tenantId, stored.path);
      } catch (error) {
        await discardPhoto(stored.path);
        throw error;
      }
      if (!swap.found) {
        await discardPhoto(stored.path);
        return notFound("Η εταιρία δεν βρέθηκε");
      }
      if (swap.previous && swap.previous !== stored.path) await removeObjects([swap.previous]);

      const urls = await signUrls([stored.path]);
      return created({ url: urls.get(stored.path) ?? null });
    } catch (error) {
      if (error instanceof StorageError) return storageErrorResponse(error);
      console.error(error);
      return serverError();
    }
  },
  "settings.edit"
);

// DELETE /api/settings/logo
export const DELETE = withPermission(
  async (_req, session) => {
    try {
      const tenantId = session.tenantId;
      if (!tenantId) return notFound("Η εταιρία δεν βρέθηκε");
      const swap = await swapLogo(tenantId, null);
      if (!swap.found) return notFound("Η εταιρία δεν βρέθηκε");
      if (swap.previous) await removeObjects([swap.previous]);
      return ok({ url: null });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "settings.edit"
);
