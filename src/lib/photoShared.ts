// src/lib/photoShared.ts
// Κοινά για τις φωτογραφίες (συμβόλαια + ζημιές) — client ΚΑΙ server.
// Χωρίς db: το φορτώνουν και client components.

/** Επιτρεπτοί τύποι — ίδιοι με τις ρυθμίσεις του bucket. */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

/**
 * Μέγιστο μέγεθος ανά αρχείο στον server. Κάτω από το όριο σώματος
 * αιτήματος του Vercel (4,5 MB). Μετά τη συμπίεση στον client μια
 * φωτογραφία είναι συνήθως 200–500 KB.
 */
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;

/** Όρια πλήθους. */
export const MAX_CONTRACT_PHOTOS = 40;
export const MAX_DAMAGE_PHOTOS = 20;

/** Συμπίεση στον client. */
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_JPEG_QUALITY = 0.85;

export const PHOTO_NOTE_MAX = 200;

/** Καταλήξεις εικόνας (και του iPhone: HEIC/HEIF) — για αρχεία χωρίς τύπο. */
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i;

/**
 * Δεκτό αρχείο για «Κάμερα»/«Συλλογή»: τύπος image/*, Ή κενός/γενικός τύπος
 * (το iOS δίνει συχνά κενό file.type, π.χ. σε HEIC) με κατάληξη εικόνας, Ή
 * κενός τύπος χωρίς όνομα (φωτογραφία κάμερας). Ό,τι περνά εδώ μετατρέπεται
 * σε JPEG στον browser (compressImage)· αν δεν διαβάζεται, βγαίνει μήνυμα.
 */
export function isImageFile(file: { type: string; name: string }): boolean {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  if (type && type !== "application/octet-stream") return false;
  return !file.name || IMAGE_EXT_RE.test(file.name);
}

/** Μία φωτογραφία όπως τη βλέπει η οθόνη. */
export interface PhotoItem {
  id: string;
  /** Προσωρινό URL· null όταν δεν βγήκε (π.χ. δεν έχει ρυθμιστεί το Storage). */
  url: string | null;
  takenAt: string | null;
  note: string;
}

/** Το id μιας φωτογραφίας = το τυχαίο όνομα του αρχείου, χωρίς κατάληξη. */
export const photoIdOf = (path: string): string =>
  (path.split("/").pop() ?? path).replace(/\.[a-z0-9]+$/i, "");

export const PHOTO_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
