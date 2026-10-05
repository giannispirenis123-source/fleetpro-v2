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
  MAX_LICENSE_PHOTOS,
  licenseLockOf,
  photoLockOf,
  readDrivers,
  readPhotos,
  type ContractPhoto,
  type ContractPhotoDTO,
  type PhotoGroup,
} from "./contracts";
import { signUrls } from "./storage";
import { photoIdOf } from "./photoShared";

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

/* ─────────────────────────────────────────────
   Φωτογραφίες διπλώματος (ανά οδηγό, έως MAX_LICENSE_PHOTOS)
   ───────────────────────────────────────────── */

const LICENSE_LOCK_MESSAGE: Record<string, string> = {
  signed: "Η φωτογραφία διπλώματος δεν διαγράφεται μετά την πρώτη υπογραφή",
  completed: "Το συμβόλαιο έχει ολοκληρωθεί και δεν αλλάζει",
};

export type LicenseMutation =
  | { ok: true; removed: string | null }
  | { ok: false; status: 404 | 409; message: string };

/**
 * Προσθέτει (`add` = διαδρομή) ή αφαιρεί (`removeId` = id φωτογραφίας) μία
 * φωτογραφία διπλώματος, ατομικά με SELECT … FOR UPDATE και ΧΩΡΙΣ αλλαγή
 * του "updatedAt" (όπως οι ζημιές). Ο κανόνας κλειδώματος και το όριο
 * ξαναελέγχονται μέσα στο κλείδωμα. Η εγγραφή είναι πάντα στη νέα μορφή
 * (πίνακας)· τα παλιά front/back έχουν ήδη γίνει πίνακας στην ανάγνωση.
 * Επιστρέφει τη διαδρομή που αφαιρέθηκε — ο καλών σβήνει το αρχείο ΜΕΤΑ.
 */
export async function mutateLicensePhotos(
  viewer: Viewer,
  contractId: string,
  driverId: string,
  change: { add: string } | { removeId: string }
): Promise<LicenseMutation> {
  const scoped = await findScopedContract(viewer, contractId);
  if (!scoped) return { ok: false, status: 404, message: "Το συμβόλαιο δεν βρέθηκε" };

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string; drivers: unknown }[]>(Prisma.sql`
      SELECT "status"::text AS "status", "drivers"
      FROM "contracts"
      WHERE "id" = ${scoped.id} AND "tenantId" = ${scoped.tenantId}
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) return { ok: false as const, status: 404 as const, message: "Το συμβόλαιο δεν βρέθηκε" };

    const drivers = readDrivers(row.drivers);
    const lock = licenseLockOf("add" in change ? "upload" : "delete", row.status, drivers);
    if (lock) return { ok: false as const, status: 409 as const, message: LICENSE_LOCK_MESSAGE[lock] };

    const index = drivers.findIndex((d) => d.id === driverId);
    if (index < 0) {
      return { ok: false as const, status: 404 as const, message: "Ο οδηγός δεν βρέθηκε — αποθήκευσε πρώτα το συμβόλαιο" };
    }
    const driver = drivers[index];
    const current = driver.licensePhotos ?? [];
    let next: string[];
    let removed: string | null = null;
    if ("add" in change) {
      if (current.length >= MAX_LICENSE_PHOTOS) {
        return { ok: false as const, status: 409 as const, message: `Έως ${MAX_LICENSE_PHOTOS} φωτογραφίες διπλώματος ανά οδηγό` };
      }
      next = [...current, change.add];
    } else {
      removed = current.find((p) => photoIdOf(p) === change.removeId) ?? null;
      if (!removed) return { ok: false as const, status: 404 as const, message: "Η φωτογραφία δεν βρέθηκε" };
      next = current.filter((p) => p !== removed);
    }
    const { licensePhotos: _old, ...rest } = driver;
    drivers[index] = next.length ? { ...rest, licensePhotos: next } : rest;

    await tx.$executeRaw(Prisma.sql`
      UPDATE "contracts"
      SET "drivers" = ${JSON.stringify(drivers)}::jsonb
      WHERE "id" = ${scoped.id}
    `);
    return { ok: true as const, removed };
  });
}
