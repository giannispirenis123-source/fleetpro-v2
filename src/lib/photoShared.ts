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
export const PHOTO_JPEG_QUALITY = 0.8;

export const PHOTO_NOTE_MAX = 200;

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
