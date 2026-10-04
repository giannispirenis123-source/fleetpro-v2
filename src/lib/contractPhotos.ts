// src/lib/contractPhotos.ts
// Φωτογραφίες ζημιών συμβολαίου — server-only.
//
// Η λίστα ζει στο contracts."damagePhotos" και αλλάζει με raw SQL μέσα σε
// transaction με SELECT … FOR UPDATE:
//  · ταυτόχρονα ανεβάσματα δεν χάνουν το ένα το άλλο·
//  · ο κανόνας κλειδώματος ξαναελέγχεται ΜΕΣΑ στο κλείδωμα (π.χ. υπέγραψε
//    κάποιος στο μεταξύ)·
//  · το "updatedAt" ΔΕΝ αλλάζει, ώστε μια φωτογραφία να μη χαλάει την
//    αποθήκευση της φόρμας που είναι ανοιχτή (αισιόδοξο κλείδωμα).

import { Prisma } from "@prisma/client";
import { db } from "./db";
import type { Viewer } from "./authz";
import { contractScope } from "./contractForm";
import {
  photoLockOf,
  readDrivers,
  readPhotos,
  type ContractPhoto,
  type ContractPhotoDTO,
  type PhotoGroup,
} from "./contracts";
import { signUrls } from "./storage";

/** Το συμβόλαιο, αν το βλέπει ο χρήστης (tenant + στεγανότητα συνεργάτη). */
export const findScopedContract = (viewer: Viewer, id: string) =>
  db.contract.findFirst({
    where: { ...contractScope(viewer), id },
    select: { id: true, tenantId: true },
  });

/** Προσωρινά URLs για τις φωτογραφίες — σε κάθε φόρτωση σελίδας. */
export async function signContractPhotos(photos: ContractPhoto[]): Promise<ContractPhotoDTO[]> {
  const urls = await signUrls(photos.map((p) => p.path));
  return photos.map((p) => ({
    id: p.id,
    group: p.group,
    url: urls.get(p.path) ?? null,
    takenAt: p.takenAt,
    note: p.note,
  }));
}

export const toPhotoDTO = (p: ContractPhoto, url: string | null): ContractPhotoDTO => ({
  id: p.id,
  group: p.group,
  url,
  takenAt: p.takenAt,
  note: p.note,
});

const LOCK_MESSAGE: Record<string, string> = {
  signed: "Οι φωτογραφίες παραλαβής κλειδώνουν με την πρώτη υπογραφή",
  completed: "Το συμβόλαιο έχει ολοκληρωθεί και δεν αλλάζει",
};

export type PhotoMutation =
  | { ok: true; photos: ContractPhoto[] }
  | { ok: false; status: 404 | 409; message: string };

/**
 * Αλλάζει τη λίστα φωτογραφιών ατομικά. Το `fn` παίρνει την τρέχουσα λίστα
 * και επιστρέφει τη νέα, ή σφάλμα. Το `group` είναι η ομάδα που αγγίζεται,
 * για τον έλεγχο κλειδώματος.
 */
export async function mutateContractPhotos(
  viewer: Viewer,
  contractId: string,
  fn: (photos: ContractPhoto[]) => { ok: true; photos: ContractPhoto[]; group: PhotoGroup } | { ok: false; status: 404 | 409; message: string }
): Promise<PhotoMutation> {
  const scoped = await findScopedContract(viewer, contractId);
  if (!scoped) return { ok: false, status: 404, message: "Το συμβόλαιο δεν βρέθηκε" };

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { status: string; drivers: unknown; damagePhotos: unknown }[]
    >(Prisma.sql`
      SELECT "status"::text AS "status", "drivers", "damagePhotos"
      FROM "contracts"
      WHERE "id" = ${scoped.id} AND "tenantId" = ${scoped.tenantId}
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) return { ok: false as const, status: 404 as const, message: "Το συμβόλαιο δεν βρέθηκε" };

    const result = fn(readPhotos(row.damagePhotos));
    if (!result.ok) return result;

    const lock = photoLockOf(result.group, row.status, readDrivers(row.drivers));
    if (lock) return { ok: false as const, status: 409 as const, message: LOCK_MESSAGE[lock] };

    await tx.$executeRaw(Prisma.sql`
      UPDATE "contracts"
      SET "damagePhotos" = ${JSON.stringify(result.photos)}::jsonb
      WHERE "id" = ${scoped.id}
    `);
    return { ok: true as const, photos: result.photos };
  });
}
