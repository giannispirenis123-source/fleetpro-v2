// src/lib/vehiclePhotos.ts
// Φωτογραφίες οχήματος (Cloudinary) — καθαρή λογική, ΧΩΡΙΣ runtime imports,
// ώστε να τη φορτώνουν ο Στόλος (client), τα API routes και τα tests.
//
// Κανόνες:
//  · Έως 10 φωτογραφίες ανά όχημα. Κύρια = η πρώτη στη σειρά (order 0).
//  · Αποθήκευση: vehicles."photos" (JSONB) = [{ id, url, publicId, order }].
//  · Φάκελος Cloudinary: fleetpro/{companyId}/vehicles/{vehicleId}. Ο server
//    δέχεται μόνο publicId μέσα σε αυτόν τον φάκελο και φτιάχνει ο ίδιος το URL.
//  · Μόνο Διαχειριστής (COMPANY_ADMIN) ανεβάζει, διαγράφει, αλλάζει σειρά.

export const MAX_VEHICLE_PHOTOS = 10;

/** Τύποι που δέχεται το Cloudinary στο υπογεγραμμένο ανέβασμα. */
export const VEHICLE_PHOTO_FORMATS = ["jpg", "jpeg", "png", "webp"] as const;
export const ALLOWED_FORMATS_PARAM = VEHICLE_PHOTO_FORMATS.join(",");

export interface VehiclePhoto {
  id: string;
  url: string;
  /** null μόνο για παλιά URL (στήλη images) που δεν είναι του Cloudinary. */
  publicId: string | null;
  order: number;
}

/** Ό,τι χρειάζεται η οθόνη (χωρίς publicId). */
export interface VehiclePhotoView {
  id: string;
  url: string;
}

export const PHOTO_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PUBLIC_ID_RE = /^[A-Za-z0-9_\-/]{1,255}$/;

/** fleetpro/{companyId}/vehicles/{vehicleId} — ή null για μη ασφαλή ids. */
export function vehiclePhotoFolder(companyId: string, vehicleId: string): string | null {
  if (!SAFE_SEGMENT_RE.test(companyId) || !SAFE_SEGMENT_RE.test(vehicleId)) return null;
  return `fleetpro/${companyId}/vehicles/${vehicleId}`;
}

/** Το publicId ανήκει ΑΚΡΙΒΩΣ σε αυτόν τον φάκελο (χωρίς υποφακέλους, χωρίς «..»). */
export function isPublicIdInFolder(publicId: unknown, folder: string): publicId is string {
  if (typeof publicId !== "string" || !PUBLIC_ID_RE.test(publicId)) return false;
  if (!publicId.startsWith(folder + "/")) return false;
  return SAFE_SEGMENT_RE.test(publicId.slice(folder.length + 1));
}

/**
 * Το URL της φωτογραφίας φτιάχνεται στον server από cloud name, έκδοση,
 * publicId και τύπο — ποτέ από ό,τι στείλει ο browser.
 */
export function cloudinaryImageUrl(cloudName: string, version: number, publicId: string, format: string): string {
  return `https://res.cloudinary.com/${cloudName}/image/upload/v${version}/${publicId}.${format}`;
}

const UPLOAD_RE = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;

/**
 * Μικρογραφία με transformations του Cloudinary: f_auto (WebP/AVIF όπου
 * γίνεται), q_auto και πλάτος. Για ξένα URL επιστρέφει το ίδιο.
 */
export function cloudinaryThumb(url: string, width: number): string {
  const m = UPLOAD_RE.exec(url);
  if (!m) return url;
  const w = Math.max(16, Math.min(2000, Math.round(width)));
  return `${m[1]}f_auto,q_auto,c_limit,w_${w}/${m[2]}`;
}

/** Το publicId από URL του Cloudinary (για τη μεταφορά της στήλης images). */
export function publicIdFromUrl(url: string): string | null {
  const m = UPLOAD_RE.exec(url);
  if (!m) return null;
  const path = m[2].replace(/^v\d+\//, "");
  const id = path.replace(/\.[A-Za-z0-9]+$/, "");
  return PUBLIC_ID_RE.test(id) ? id : null;
}

/** Ανάγνωση της στήλης photos: αγνοεί ό,τι δεν έχει σχήμα, ταξινομεί κατά order. */
export function readVehiclePhotos(value: unknown): VehiclePhoto[] {
  if (!Array.isArray(value)) return [];
  const list = value.flatMap((x, i) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.url !== "string" || !/^https:\/\//.test(o.url)) return [];
    return [
      {
        id: o.id,
        url: o.url,
        publicId: typeof o.publicId === "string" ? o.publicId : null,
        order: typeof o.order === "number" && Number.isFinite(o.order) ? o.order : i,
        i,
      },
    ];
  });
  return list
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map(({ id, url, publicId }, order) => ({ id, url, publicId, order }));
}

export const toPhotoViews = (photos: VehiclePhoto[]): VehiclePhotoView[] =>
  photos.map(({ id, url }) => ({ id, url }));

/** Η κύρια φωτογραφία (η πρώτη) — null αν δεν υπάρχει. */
export const mainPhotoUrl = (photos: { url: string }[]): string | null => photos[0]?.url ?? null;

/** Μετακίνηση μίας θέσης πάνω (-1) ή κάτω (+1). Στα άκρα: ίδια σειρά. */
export function movePhoto<T extends { id: string }>(list: T[], id: string, dir: -1 | 1): T[] {
  const from = list.findIndex((p) => p.id === id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= list.length) return list;
  const next = list.slice();
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * Νέα σειρά από λίστα ids: πρέπει να είναι ΑΚΡΙΒΩΣ οι ίδιες φωτογραφίες
 * (καμία λείπει, καμία διπλή, καμία ξένη). Αλλιώς null.
 */
export function reorderPhotos(current: VehiclePhoto[], ids: unknown): VehiclePhoto[] | null {
  if (!Array.isArray(ids) || ids.length !== current.length) return null;
  if (new Set(ids).size !== ids.length) return null;
  const byId = new Map(current.map((p) => [p.id, p]));
  const out: VehiclePhoto[] = [];
  for (const id of ids) {
    const p = typeof id === "string" ? byId.get(id) : undefined;
    if (!p) return null;
    out.push({ ...p, order: out.length });
  }
  return out;
}

/** Χωρά άλλη μία; */
export const canAddPhoto = (count: number): boolean => count < MAX_VEHICLE_PHOTOS;

/* ─────────────────────────────────────────────
   Μηνύματα (ίδια σε UI και server)
   ───────────────────────────────────────────── */

export const VEHICLE_PHOTO_MSG = {
  adminOnly: "Μόνο ο Διαχειριστής μπορεί να αλλάξει τις φωτογραφίες οχήματος",
  notFound: "Το όχημα δεν βρέθηκε",
  photoNotFound: "Η φωτογραφία δεν βρέθηκε",
  limit: `Έως ${MAX_VEHICLE_PHOTOS} φωτογραφίες ανά όχημα. Διαγράψτε μία για να προσθέσετε νέα.`,
  badType: "Επιτρέπονται μόνο εικόνες JPEG, PNG ή WebP.",
  badUpload: "Μη έγκυρα στοιχεία φωτογραφίας",
  badOrder: "Μη έγκυρη σειρά φωτογραφιών",
  changed: "Οι φωτογραφίες άλλαξαν στο μεταξύ. Ανανεώστε τη σελίδα και ξαναδοκιμάστε.",
  notConfigured:
    "Οι φωτογραφίες οχημάτων δεν έχουν ρυθμιστεί: λείπουν μεταβλητές Cloudinary στις ρυθμίσεις του server",
  deleteFailed: "Η διαγραφή από το Cloudinary απέτυχε. Δοκιμάστε ξανά.",
} as const;
