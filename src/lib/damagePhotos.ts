// src/lib/damagePhotos.ts
// Φωτογραφίες ζημιάς (σελίδα Service & Ζημιές) — server-only.
// Ζουν στο υπάρχον damages."photos" (TEXT[]) ως διαδρομές στο ίδιο
// ιδιωτικό bucket με τα συμβόλαια. Οι αλλαγές είναι ατομικές σε SQL
// (array_append / array_remove), ώστε ταυτόχρονα ανεβάσματα να μη χάνονται.

import { Prisma } from "@prisma/client";
import { db } from "./db";
import { MAX_DAMAGE_PHOTOS, photoIdOf, type PhotoItem } from "./photoShared";
import { signUrls } from "./storage";

export async function findDamage(tenantId: string, id: string) {
  const d = await db.damage.findFirst({
    where: { id, tenantId },
    select: { id: true, tenantId: true, photos: true },
  });
  // Παλιές εγγραφές μπορεί να έχουν NULL αντί για κενή λίστα.
  return d ? { ...d, photos: d.photos ?? [] } : null;
}

/** Οι φωτογραφίες με νέα προσωρινά URLs. */
export async function signDamagePhotos(paths: string[]): Promise<PhotoItem[]> {
  const urls = await signUrls(paths);
  return paths.map((p) => ({ id: photoIdOf(p), url: urls.get(p) ?? null, takenAt: null, note: "" }));
}

/** Προσθέτει διαδρομή μόνο αν δεν ξεπερνιέται το όριο. true = μπήκε. */
export async function appendDamagePhoto(tenantId: string, id: string, path: string) {
  const n = await db.$executeRaw(Prisma.sql`
    UPDATE "damages"
    SET "photos" = array_append(coalesce("photos", '{}'::text[]), ${path}), "updatedAt" = now()
    WHERE "id" = ${id} AND "tenantId" = ${tenantId}
      AND coalesce(cardinality("photos"), 0) < ${MAX_DAMAGE_PHOTOS}
  `);
  return n > 0;
}

export async function removeDamagePhoto(tenantId: string, id: string, path: string) {
  await db.$executeRaw(Prisma.sql`
    UPDATE "damages"
    SET "photos" = array_remove("photos", ${path}), "updatedAt" = now()
    WHERE "id" = ${id} AND "tenantId" = ${tenantId}
  `);
}
