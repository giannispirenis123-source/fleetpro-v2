export const dynamic = "force-dynamic";
// src/app/api/contracts/[id]/photos/[photoId]/route.ts
// Σημείωση ή διαγραφή μίας φωτογραφίας (contracts.edit), με τον ίδιο
// κανόνα κλειδώματος με το ανέβασμα.

import { z } from "zod";
import { ok, badRequest, conflict, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { PHOTO_NOTE_MAX } from "@/lib/photoShared";
import { removeObjects } from "@/lib/storage";
import { mutateContractPhotos } from "@/lib/contractPhotos";
import type { ContractPhoto } from "@/lib/contracts";

const noteSchema = z.object({ note: z.string().max(PHOTO_NOTE_MAX).transform((s) => s.trim()) });

const fail = (r: { status: 404 | 409; message: string }) =>
  r.status === 404 ? notFound(r.message) : conflict(r.message);

// PATCH /api/contracts/[id]/photos/[photoId] { note }
export const PATCH = withPermission(
  async (req, _session, params, viewer) => {
    try {
      const parsed = noteSchema.safeParse(await req.json());
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);

      const result = await mutateContractPhotos(viewer!, params!.id, (photos) => {
        const target = photos.find((p) => p.id === params!.photoId);
        if (!target) return { ok: false, status: 404, message: "Η φωτογραφία δεν βρέθηκε" };
        return {
          ok: true,
          group: target.group,
          photos: photos.map((p) => (p.id === target.id ? { ...p, note: parsed.data.note } : p)),
        };
      });
      if (!result.ok) return fail(result);
      return ok({ note: parsed.data.note });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "contracts.edit"
);

// DELETE /api/contracts/[id]/photos/[photoId]
export const DELETE = withPermission(
  async (_req, _session, params, viewer) => {
    try {
      let removed: ContractPhoto | undefined;
      const result = await mutateContractPhotos(viewer!, params!.id, (photos) => {
        removed = photos.find((p) => p.id === params!.photoId);
        if (!removed) return { ok: false, status: 404, message: "Η φωτογραφία δεν βρέθηκε" };
        return { ok: true, group: removed.group, photos: photos.filter((p) => p !== removed) };
      });
      if (!result.ok) return fail(result);

      // Πρώτα η βάση, μετά το αρχείο: στη χειρότερη μένει ένα ορφανό αρχείο,
      // ποτέ μια εγγραφή που δείχνει σε αρχείο που δεν υπάρχει.
      if (removed) await removeObjects([removed.path]);
      return ok({ id: params!.photoId });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "contracts.edit"
);
