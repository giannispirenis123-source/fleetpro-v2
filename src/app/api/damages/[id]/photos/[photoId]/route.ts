export const dynamic = "force-dynamic";
// src/app/api/damages/[id]/photos/[photoId]/route.ts
// Διαγραφή φωτογραφίας ζημιάς (damages.edit).

import { ok, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { photoIdOf } from "@/lib/photoShared";
import { removeObjects } from "@/lib/storage";
import { findDamage, removeDamagePhoto } from "@/lib/damagePhotos";

// DELETE /api/damages/[id]/photos/[photoId]
export const DELETE = withPermission(
  async (_req, session, params) => {
    try {
      const damage = await findDamage(session.tenantId!, params!.id);
      if (!damage) return notFound("Η ζημιά δεν βρέθηκε");

      const path = damage.photos.find((p) => photoIdOf(p) === params!.photoId);
      if (!path) return notFound("Η φωτογραφία δεν βρέθηκε");

      await removeDamagePhoto(damage.tenantId, damage.id, path);
      await removeObjects([path]);
      return ok({ id: params!.photoId });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "damages.edit"
);
