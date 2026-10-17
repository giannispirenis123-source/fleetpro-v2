// src/lib/public/places.ts
// «Μέρη για επίσκεψη» — καθαρή λογική (χωρίς βάση): σχήμα της φόρμας,
// ποια μέρη βλέπει ο πελάτης και με ποια σειρά, δημόσια DTO.
//
// Κανόνες:
// · ΜΟΝΟ ενεργά μέρη της εταιρίας (δεύτερη δικλείδα πέρα από το WHERE).
// · Χωρίς τοποθεσία παραλαβής (pl): όλα τα ενεργά, με τη σειρά τους.
// · Με τοποθεσία: ΠΡΩΤΑ όσα είναι δεμένα σε αυτήν, ΜΕΤΑ τα «όλες οι
//   τοποθεσίες». Μέρη δεμένα ΜΟΝΟ σε άλλες τοποθεσίες δεν εμφανίζονται.
// · Στο site φεύγουν ΜΟΝΟ δημόσια πεδία (όχι ids, tenantId, σειρά, publicId).

import { z } from "zod";
import { readLocalized, textFor, type LocalizedText } from "./text";
import { readVehiclePhotos } from "../vehiclePhotos";

export const PLACE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PLACE_DETAILS_MAX = 20;

const i18n = (max: number, required = false, label = "Το ελληνικό κείμενο") =>
  z
    .record(z.string().regex(/^[a-z]{2}$/), z.string().max(max, `Έως ${max} χαρακτήρες`))
    .default({})
    .transform((t) => readLocalized(t, max))
    .refine((t) => !required || !!t.el, `${label} είναι υποχρεωτικό`);

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .default(null)
  .transform((v) => v || null)
  .refine((v) => v === null || /^https:\/\/[^\s<>"']+$/.test(v), "Το link πρέπει να ξεκινά με https://");

const idList = z
  .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
  .max(200)
  .default([])
  .transform((l) => Array.from(new Set(l)));

export interface PlaceDetail {
  label: LocalizedText;
  value: LocalizedText;
}

/** Λίστα στοιχείων από JSON: μόνο γραμμές με ετικέτα ΚΑΙ τιμή. */
export function readPlaceDetails(value: unknown): PlaceDetail[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((x) => {
      if (!x || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      const label = readLocalized(o.label, 60);
      const val = readLocalized(o.value, 200);
      return Object.keys(label).length && Object.keys(val).length ? [{ label, value: val }] : [];
    })
    .slice(0, PLACE_DETAILS_MAX);
}

export const placeSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(PLACE_SLUG_RE, "Slug: λατινικά πεζά, αριθμοί και παύλα (π.χ. balos-lagoon)")
      .min(2, "Τουλάχιστον 2 χαρακτήρες")
      .max(60, "Έως 60 χαρακτήρες"),
    nameI18n: i18n(80, true, "Το όνομα (ΕΛ)"),
    shortI18n: i18n(120),
    descriptionI18n: i18n(4000),
    detailsI18n: z
      .array(z.object({ label: i18n(60), value: i18n(200) }))
      .max(PLACE_DETAILS_MAX, `Έως ${PLACE_DETAILS_MAX} στοιχεία`)
      .default([])
      .transform((l) => l.filter((d) => Object.keys(d.label).length > 0 && Object.keys(d.value).length > 0)),
    mapUrl: httpsUrl,
    allLocations: z.boolean().default(true),
    locationIds: idList,
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .refine((p) => p.allLocations || p.locationIds.length > 0, {
    message: "Διάλεξε τουλάχιστον μία τοποθεσία ή «Όλες οι τοποθεσίες»",
    path: ["locationIds"],
  });

export type PlaceInput = z.infer<typeof placeSchema>;

/** Η εγγραφή της φόρμας → δεδομένα Prisma (οι τοποθεσίες στον πίνακα place_locations). */
export function placeToData(d: PlaceInput, mode: "create" | "update") {
  const { locationIds, ...rest } = d;
  const ids = d.allLocations ? [] : locationIds;
  const create = ids.map((pickupLocationId) => ({ pickupLocationId }));
  return {
    ...rest,
    locations: mode === "create" ? { create } : { deleteMany: {}, create },
  };
}

/* ─────────────────────────────────────────────
   Τι βλέπει ο πελάτης
   ───────────────────────────────────────────── */

export interface PlaceRow {
  id: string;
  tenantId: string;
  slug: string;
  nameI18n: unknown;
  shortI18n: unknown;
  descriptionI18n: unknown;
  detailsI18n: unknown;
  mapUrl: string | null;
  coverImage: string | null;
  photos: unknown;
  allLocations: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Τα pickupLocationId του place_locations. */
  locationIds: string[];
}

/**
 * Τα μέρη της αρχικής, με τη σειρά τους. `pickupLocationId` = η τοποθεσία που
 * διάλεξε ο πελάτης (pl), ήδη μεταφρασμένη από slug σε id ΤΗΣ ΙΔΙΑΣ εταιρίας.
 */
export function visiblePlaces<T extends PlaceRow>(rows: T[], companyId: string, pickupLocationId: string | null): T[] {
  const mine = rows
    .filter((p) => p.tenantId === companyId && p.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
  if (!pickupLocationId) return mine;
  const here = mine.filter((p) => !p.allLocations && p.locationIds.includes(pickupLocationId));
  const everywhere = mine.filter((p) => p.allLocations);
  return [...here, ...everywhere];
}

export interface PublicPlaceCard {
  slug: string;
  name: string;
  short: string;
  coverUrl: string | null;
}

export interface PublicPlace extends PublicPlaceCard {
  description: string;
  details: { label: string; value: string }[];
  mapUrl: string | null;
  photos: string[];
}

const photoUrls = (p: Pick<PlaceRow, "photos" | "coverImage">) => {
  const urls = readVehiclePhotos(p.photos).map((x) => x.url);
  if (urls.length === 0 && p.coverImage && /^https:\/\//.test(p.coverImage)) urls.push(p.coverImage);
  return urls;
};

export function toPublicPlaceCard(p: PlaceRow, lang: string): PublicPlaceCard {
  return {
    slug: p.slug,
    name: textFor(p.nameI18n, lang),
    short: textFor(p.shortI18n, lang),
    coverUrl: photoUrls(p)[0] ?? null,
  };
}

export function toPublicPlace(p: PlaceRow, lang: string): PublicPlace {
  const photos = photoUrls(p);
  return {
    ...toPublicPlaceCard(p, lang),
    description: textFor(p.descriptionI18n, lang),
    details: readPlaceDetails(p.detailsI18n)
      .map((d) => ({ label: textFor(d.label, lang), value: textFor(d.value, lang) }))
      .filter((d) => d.label && d.value),
    mapUrl: p.mapUrl && /^https:\/\//.test(p.mapUrl) ? p.mapUrl : null,
    photos,
  };
}

/** Το μέρος μιας σελίδας /places/<slug>: ΜΟΝΟ ενεργό και της ίδιας εταιρίας (αλλιώς null → 404). */
export function findPublicPlace<T extends PlaceRow>(rows: T[], companyId: string, slug: string): T | null {
  return rows.find((p) => p.tenantId === companyId && p.isActive && p.slug === slug) ?? null;
}

const GREEK: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x",
  ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};

/** Πρόταση slug από το όνομα (π.χ. «Λιμνοθάλασσα Μπάλου» → «limnothalassa-mpalou»). */
export function suggestPlaceSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ου/g, "ou")
    .split("")
    .map((ch) => GREEK[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}
