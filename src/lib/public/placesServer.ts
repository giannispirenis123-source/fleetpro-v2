// src/lib/public/placesServer.ts
// Μέρη και κριτικές για το δημόσιο site — ΜΟΝΟ server. Η εταιρία έρχεται
// ΠΑΝΤΑ από το resolveStorefrontCompany (companyId)· κάθε ερώτημα φιλτράρει
// με αυτήν. Στη σελίδα φεύγουν μόνο τα δημόσια DTO.

import { unstable_cache } from "next/cache";
import { db } from "../db";
import {
  findPublicPlace,
  toPublicPlace,
  toPublicPlaceCard,
  visiblePlaces,
  type PlaceRow,
  type PublicPlace,
  type PublicPlaceCard,
} from "./places";
import {
  aggregateRatingJsonLd,
  buildReviewSection,
  fetchGooglePlace,
  manualReviews,
  GOOGLE_REVALIDATE_SECONDS,
  type FetchLike,
  type GooglePlaceSummary,
  type ReviewSection,
} from "./reviews";

class GoogleUnavailable extends Error {}

/**
 * Google ανά (placeId, γλώσσα) στη cache του Next για 24 ώρες — ΟΧΙ στη βάση.
 * Οι σελίδες είναι force-dynamic, γι' αυτό η cache είναι ρητή (unstable_cache)
 * και όχι μόνο το revalidate του fetch. Αποτυχία = exception → ΔΕΝ μένει στην
 * cache (ξαναδοκιμάζει στο επόμενο άνοιγμα).
 */
const cachedGooglePlace = unstable_cache(
  async (placeId: string, lang: string): Promise<GooglePlaceSummary> => {
    const out = await fetchGooglePlace(placeId, lang, {
      apiKey: process.env.GOOGLE_PLACES_API_KEY,
      fetch: fetch as unknown as FetchLike,
    });
    if (!out) throw new GoogleUnavailable();
    return out;
  },
  ["google-place-v1"],
  { revalidate: GOOGLE_REVALIDATE_SECONDS }
);

const PLACE_SELECT = {
  id: true,
  tenantId: true,
  slug: true,
  nameI18n: true,
  shortI18n: true,
  descriptionI18n: true,
  detailsI18n: true,
  mapUrl: true,
  coverImage: true,
  photos: true,
  allLocations: true,
  isActive: true,
  sortOrder: true,
  locations: { select: { pickupLocationId: true } },
} as const;

type Loaded = Omit<PlaceRow, "locationIds"> & { locations: { pickupLocationId: string }[] };
const toRow = (p: Loaded): PlaceRow => ({ ...p, locationIds: p.locations.map((l) => l.pickupLocationId) });

/** Οι κάρτες της αρχικής. `plSlug` = η τοποθεσία παραλαβής από το URL (αν υπάρχει). */
export async function loadSitePlaces(companyId: string, plSlug: string | null, lang: string): Promise<PublicPlaceCard[]> {
  const [rows, pl] = await Promise.all([
    db.place.findMany({ where: { tenantId: companyId, isActive: true }, select: PLACE_SELECT }),
    plSlug
      ? db.pickupLocation.findFirst({ where: { tenantId: companyId, slug: plSlug, isActive: true }, select: { id: true } })
      : Promise.resolve(null),
  ]);
  return visiblePlaces((rows as Loaded[]).map(toRow), companyId, pl?.id ?? null).map((p) => toPublicPlaceCard(p, lang));
}

/** Η σελίδα ενός μέρους — null (→ 404) για ανενεργό ή μέρος άλλης εταιρίας. */
export async function loadSitePlace(companyId: string, slug: string, lang: string): Promise<PublicPlace | null> {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  const rows = await db.place.findMany({ where: { tenantId: companyId, slug, isActive: true }, select: PLACE_SELECT });
  const row = findPublicPlace((rows as Loaded[]).map(toRow), companyId, slug);
  return row ? toPublicPlace(row, lang) : null;
}

/**
 * Η ενότητα «Κριτικές πελατών»: χειροκίνητες + Google (Places API, cache 24ω,
 * ΠΟΤΕ στη βάση). null = καμία κριτική → η ενότητα δεν εμφανίζεται.
 */
export async function loadReviewSection(
  companyId: string,
  lang: string,
  company: { name: string; url: string },
  deps: { apiKey?: string; fetch?: FetchLike } = {}
): Promise<{ section: ReviewSection | null; jsonLd: Record<string, unknown> | null }> {
  const [rows, locations] = await Promise.all([
    db.review.findMany({
      where: { tenantId: companyId, isActive: true },
      select: { id: true, tenantId: true, authorName: true, rating: true, text: true, reviewDate: true, sourceUrl: true, isActive: true, sortOrder: true },
    }),
    db.pickupLocation.findMany({
      where: { tenantId: companyId, isActive: true, googlePlaceId: { not: null } },
      select: { googlePlaceId: true },
      orderBy: [{ sortOrder: "asc" }],
    }),
  ]);
  const manual = manualReviews(rows, companyId, lang);
  const apiKey = deps.apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
  const placeIds = Array.from(new Set(locations.map((l) => l.googlePlaceId).filter((x): x is string => !!x)));
  // Χωρίς κλειδί: ούτε αίτημα ούτε σφάλμα — μόνο οι χειροκίνητες.
  const google = apiKey
    ? await Promise.all(
        placeIds.map((id) =>
          deps.fetch
            ? fetchGooglePlace(id, lang, { apiKey, fetch: deps.fetch })
            : cachedGooglePlace(id, lang).catch(() => null)
        )
      )
    : [];
  return { section: buildReviewSection(manual, google), jsonLd: aggregateRatingJsonLd(company, manual) };
}
