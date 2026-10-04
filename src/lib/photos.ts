// src/lib/photos.ts
// Ο ΚΟΙΝΟΣ server κώδικας φωτογραφιών — συμβόλαια ΚΑΙ ζημιές.
//
// Έλεγχος αρχείου (τύπος από τα πρώτα bytes, όχι από το όνομα· μέγεθος),
// τυχαίο όνομα, ανέβασμα σε ιδιωτικό bucket. Η εγγραφή στη βάση γίνεται
// από τον καλούντα· αν αποτύχει, ο καλών σβήνει το αρχείο (discardPhoto).
//
// Server-only.

import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { badRequest } from "./api";
import { PHOTO_MAX_BYTES, PHOTO_NOTE_MAX, type PhotoType } from "./photoShared";
import { StorageError, removeObjects, storageStartupProblem, uploadObject } from "./storage";

const EXT: Record<PhotoType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Ο πραγματικός τύπος από τα πρώτα bytes. Το Content-Type του client δεν αρκεί. */
function sniff(b: Uint8Array): PhotoType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Η απάντηση για ένα σφάλμα Storage: συγκεκριμένο, ασφαλές μήνυμα (ονόματα
 * μεταβλητών, ποτέ τιμές) + κωδικός αιτίας για το UI.
 */
export const storageErrorResponse = (e: StorageError) =>
  NextResponse.json(
    { success: false, message: e.message, code: e.code },
    { status: e.httpStatus }
  );

/** Λείπει/είναι λάθος κάποια ρύθμιση; Τότε η απάντηση· αλλιώς null. */
export function storageProblemResponse(): NextResponse | null {
  const problem = storageStartupProblem();
  if (!problem) return null;
  console.error(`Storage config: ${problem.code} — ${problem.message}`);
  return storageErrorResponse(problem);
}

export interface PhotoUpload {
  bytes: Uint8Array;
  type: PhotoType;
  ext: string;
  /** Τα υπόλοιπα πεδία της φόρμας (ομάδα, σημείωση, ώρα λήψης). */
  form: FormData;
}

/**
 * Διαβάζει και ελέγχει το multipart αίτημα (πεδίο `file`). Ελέγχει ΚΑΙ το
 * Content-Length πριν διαβάσει το σώμα, ώστε τεράστιο αρχείο να κόβεται νωρίς.
 */
export async function readPhotoUpload(
  req: Request
): Promise<{ ok: true; upload: PhotoUpload } | { ok: false; response: NextResponse }> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > PHOTO_MAX_BYTES + 64 * 1024) {
    return { ok: false, response: badRequest("Η φωτογραφία είναι πολύ μεγάλη (μέγιστο 4 MB)") };
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, response: badRequest("Μη έγκυρο αρχείο") };
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return { ok: false, response: badRequest("Δεν στάλθηκε φωτογραφία") };
  }
  if (file.size === 0) return { ok: false, response: badRequest("Κενό αρχείο") };
  if (file.size > PHOTO_MAX_BYTES) {
    return { ok: false, response: badRequest("Η φωτογραφία είναι πολύ μεγάλη (μέγιστο 4 MB)") };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes);
  if (!type) {
    return { ok: false, response: badRequest("Επιτρέπονται μόνο εικόνες JPEG, PNG ή WebP") };
  }
  return { ok: true, upload: { bytes, type, ext: EXT[type], form } };
}

/** Σύντομη σημείωση από τη φόρμα. */
export const noteFrom = (form: FormData): string =>
  String(form.get("note") ?? "").trim().slice(0, PHOTO_NOTE_MAX);

/**
 * Ώρα λήψης από τον client (lastModified του αρχείου). Δεχόμαστε μόνο
 * λογικές τιμές (από 2000 έως λίγο μετά από τώρα)· αλλιώς ώρα του server.
 */
export function takenAtFrom(form: FormData): string {
  const raw = String(form.get("takenAt") ?? "");
  const t = Date.parse(raw);
  const now = Date.now();
  return Number.isFinite(t) && t > Date.UTC(2000, 0, 1) && t < now + 10 * 60_000
    ? new Date(t).toISOString()
    : new Date(now).toISOString();
}

/** Τυχαίο όνομα αρχείου — δεν μαρτυρά τίποτα για το περιεχόμενο. */
export const randomPhotoId = () => randomBytes(12).toString("base64url");

/**
 * Ανεβάζει τη φωτογραφία στο `${prefix}/${id}.${ext}` και επιστρέφει id και
 * διαδρομή. Ρίχνει StorageError με γενικό μήνυμα (χωρίς λεπτομέρειες).
 */
export async function storePhoto(prefix: string, upload: PhotoUpload) {
  const id = randomPhotoId();
  const path = `${prefix}/${id}.${upload.ext}`;
  await uploadObject(path, upload.bytes, upload.type);
  return { id, path };
}

/** Ο καλών δεν κατάφερε να γράψει στη βάση: το αρχείο δεν πρέπει να μείνει. */
export const discardPhoto = (path: string) => removeObjects([path]);

export { StorageError };
