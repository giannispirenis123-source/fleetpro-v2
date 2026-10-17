// src/lib/public/reviews.ts
// «Κριτικές πελατών» — καθαρή λογική (χωρίς βάση).
//
// Δύο πηγές:
// · ΧΕΙΡΟΚΙΝΗΤΕΣ: ό,τι προσθέτει η εταιρία στο dashboard (πίνακας reviews).
// · GOOGLE: Places API (New), ΜΟΝΟ από τον server, ΠΟΤΕ αποθηκευμένες στη
//   βάση (cache 24 ωρών του Next). Χωρίς κλειδί ή με οποιαδήποτε αποτυχία →
//   null, και η σελίδα δείχνει σιωπηλά μόνο τις χειροκίνητες.
//
// Όροι Google: ένδειξη «Google», link στην πηγή, όνομα συντάκτη με link,
// κείμενο ΟΠΩΣ το δίνει η Google (καμία αλλοίωση/περικοπή).

import { z } from "zod";
import { readLocalized, textFor } from "./text";

export const REVIEW_TEXT_MAX = 1500;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const reviewSchema = z.object({
  authorName: z.string().trim().min(1, "Το όνομα είναι υποχρεωτικό").max(80, "Έως 80 χαρακτήρες"),
  rating: z.number().int("1 έως 5 αστέρια").min(1, "1 έως 5 αστέρια").max(5, "1 έως 5 αστέρια"),
  text: z
    .record(z.string().regex(/^[a-z]{2}$/), z.string().max(REVIEW_TEXT_MAX, `Έως ${REVIEW_TEXT_MAX} χαρακτήρες`))
    .default({})
    .transform((t) => readLocalized(t, REVIEW_TEXT_MAX))
    .refine((t) => Object.keys(t).length > 0, "Γράψτε το κείμενο της κριτικής (σε μία τουλάχιστον γλώσσα)"),
  reviewDate: z
    .string()
    .regex(ISO_DATE, "Ημερομηνία σε μορφή ΕΕΕΕ-ΜΜ-ΗΗ")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Μη έγκυρη ημερομηνία")
    .transform((v) => new Date(`${v}T00:00:00.000Z`)),
  sourceUrl: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .default(null)
    .transform((v) => v || null)
    .refine((v) => v === null || /^https:\/\/[^\s<>"']+$/.test(v), "Το link πρέπει να ξεκινά με https://"),
  pickupLocationId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .nullable()
    .default(null)
    .transform((v) => v || null),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

/** Google Place ID: όπως το δίνει η Google (π.χ. ChIJN1t_tDeuEmsRUsoyG83frY4). */
export const GOOGLE_PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;

/* ─────────────────────────────────────────────
   Δημόσια μορφή
   ───────────────────────────────────────────── */

export interface PublicReview {
  key: string;
  source: "site" | "google";
  author: string;
  /** Μόνο Google: το προφίλ του συντάκτη. */
  authorUrl: string | null;
  rating: number;
  text: string;
  /** "YYYY-MM-DD" ή null. */
  date: string | null;
  /** Link στην πηγή (Google Maps ή το link που έβαλε η εταιρία). */
  sourceUrl: string | null;
}

export interface ManualReviewRow {
  id: string;
  tenantId: string;
  authorName: string;
  rating: number;
  text: unknown;
  reviewDate: Date | string;
  sourceUrl: string | null;
  isActive: boolean;
  sortOrder: number;
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const httpsOrNull = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s<>"']+$/.test(v) ? v : null);

/** Οι χειροκίνητες κριτικές της εταιρίας (ΜΟΝΟ ενεργές, ΜΟΝΟ της εταιρίας), με τη σειρά τους. */
export function manualReviews(rows: ManualReviewRow[], companyId: string, lang: string): PublicReview[] {
  return rows
    .filter((r) => r.tenantId === companyId && r.isActive && r.rating >= 1 && r.rating <= 5)
    .sort((a, b) => a.sortOrder - b.sortOrder || iso(b.reviewDate).localeCompare(iso(a.reviewDate)))
    .map((r) => ({
      key: `s:${r.id}`,
      source: "site" as const,
      author: r.authorName,
      authorUrl: null,
      rating: r.rating,
      text: textFor(r.text, lang),
      date: iso(r.reviewDate),
      sourceUrl: httpsOrNull(r.sourceUrl),
    }))
    .filter((r) => r.text);
}

/* ─────────────────────────────────────────────
   Google Places API (New)
   ───────────────────────────────────────────── */

export interface GooglePlaceSummary {
  rating: number | null;
  count: number;
  /** Το Google Maps του σημείου (link «στην πηγή»). */
  url: string | null;
  reviews: PublicReview[];
}

export const GOOGLE_REVIEWS_MAX = 5;
export const GOOGLE_FIELD_MASK = "rating,userRatingCount,googleMapsUri,reviews";
/** 24 ώρες — Next fetch cache (ΟΧΙ αποθήκευση στη βάση). */
export const GOOGLE_REVALIDATE_SECONDS = 86_400;

/** Η απάντηση του Places API → δημόσια μορφή. Οτιδήποτε άκυρο απλώς λείπει. */
export function parseGooglePlace(json: unknown, placeId: string, max = GOOGLE_REVIEWS_MAX): GooglePlaceSummary | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const rating = typeof o.rating === "number" && o.rating >= 1 && o.rating <= 5 ? o.rating : null;
  const count = typeof o.userRatingCount === "number" && o.userRatingCount > 0 ? Math.floor(o.userRatingCount) : 0;
  const url = httpsOrNull(o.googleMapsUri);
  const list = Array.isArray(o.reviews) ? o.reviews : [];
  const reviews = list
    .flatMap((r, i): PublicReview[] => {
      if (!r || typeof r !== "object") return [];
      const x = r as Record<string, unknown>;
      const stars = typeof x.rating === "number" ? Math.round(x.rating) : 0;
      // Το πρωτότυπο κείμενο, ΟΠΩΣ το δίνει η Google· αλλιώς η μετάφρασή της.
      const pick = (t: unknown) => (t && typeof t === "object" && typeof (t as { text?: unknown }).text === "string" ? (t as { text: string }).text : "");
      const text = pick(x.originalText) || pick(x.text);
      const author = x.authorAttribution && typeof x.authorAttribution === "object" ? (x.authorAttribution as Record<string, unknown>) : {};
      const name = typeof author.displayName === "string" ? author.displayName : "";
      if (stars < 1 || stars > 5 || !text || !name) return [];
      const published = typeof x.publishTime === "string" && /^\d{4}-\d{2}-\d{2}/.test(x.publishTime) ? x.publishTime.slice(0, 10) : null;
      return [
        {
          key: `g:${placeId}:${i}`,
          source: "google",
          author: name,
          authorUrl: httpsOrNull(author.uri),
          rating: stars,
          text,
          date: published,
          sourceUrl: httpsOrNull(x.googleMapsUri) ?? url,
        },
      ];
    })
    .slice(0, max);
  if (rating === null && reviews.length === 0) return null;
  return { rating, count: rating === null ? 0 : count, url, reviews };
}

export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Βαθμολογία + κριτικές ενός σημείου από το Places API (New). ΠΟΤΕ δεν ρίχνει:
 * χωρίς κλειδί / χωρίς Place ID / σφάλμα δικτύου / μη-200 → null (σιωπηλά,
 * μόνο κωδικός στα logs — ποτέ το κλειδί).
 */
export async function fetchGooglePlace(
  placeId: string | null | undefined,
  lang: string,
  deps: { apiKey: string | undefined; fetch: FetchLike }
): Promise<GooglePlaceSummary | null> {
  const key = deps.apiKey?.trim();
  if (!key || !placeId || !GOOGLE_PLACE_ID_RE.test(placeId)) return null;
  try {
    const res = await deps.fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=${encodeURIComponent(lang)}`,
      {
        headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": GOOGLE_FIELD_MASK },
        next: { revalidate: GOOGLE_REVALIDATE_SECONDS },
      }
    );
    if (!res.ok) {
      console.error("[FleetPro] Google Places: η απάντηση δεν ήταν 200");
      return null;
    }
    return parseGooglePlace(await res.json(), placeId);
  } catch {
    console.error("[FleetPro] Google Places: σφάλμα δικτύου");
    return null;
  }
}

/* ─────────────────────────────────────────────
   Η ενότητα της αρχικής
   ───────────────────────────────────────────── */

export interface ReviewSection {
  /** Συνολικό σκορ (ένα δεκαδικό) από ΟΛΕΣ τις πηγές, σταθμισμένο με το πλήθος. */
  rating: number;
  count: number;
  /** Ποιες πηγές συμμετέχουν (για τη σαφή ένδειξη). */
  googleCount: number;
  siteCount: number;
  /** Google Maps link (το πρώτο σημείο με link) — «Δείτε όλες στο Google». */
  googleUrl: string | null;
  reviews: PublicReview[];
}

/** null = καμία κριτική από καμία πηγή → η ενότητα δεν εμφανίζεται καθόλου. */
export function buildReviewSection(manual: PublicReview[], google: (GooglePlaceSummary | null)[]): ReviewSection | null {
  const g = google.filter((x): x is GooglePlaceSummary => !!x);
  const googleRated = g.filter((x) => x.rating !== null && x.count > 0);
  const googleCount = googleRated.reduce((s, x) => s + x.count, 0);
  const googleSum = googleRated.reduce((s, x) => s + (x.rating as number) * x.count, 0);
  const siteSum = manual.reduce((s, r) => s + r.rating, 0);
  const count = googleCount + manual.length;
  const googleReviews = g.flatMap((x) => x.reviews);
  if (count === 0 && googleReviews.length === 0) return null;
  // Χωρίς βαθμολογία Google, οι κριτικές Google μετρούν μία-μία.
  const extra = googleCount === 0 ? googleReviews : [];
  const total = count + extra.length;
  const sum = googleSum + siteSum + extra.reduce((s, r) => s + r.rating, 0);
  return {
    rating: Math.round((sum / total) * 10) / 10,
    count: total,
    googleCount: googleCount || extra.length,
    siteCount: manual.length,
    googleUrl: g.find((x) => x.url)?.url ?? null,
    reviews: [...manual, ...googleReviews],
  };
}

/**
 * schema.org AggregateRating — ΜΟΝΟ με πραγματικά δεδομένα: από τις κριτικές
 * που ΕΧΕΙ η εταιρία (χειροκίνητες). Τα δεδομένα του Google Places ΔΕΝ μπαίνουν
 * (οι όροι του Places API δεν επιτρέπουν αναδημοσίευσή τους ως δικά μας).
 * null αν δεν υπάρχει καμία χειροκίνητη κριτική.
 */
export function aggregateRatingJsonLd(
  company: { name: string; url: string },
  manual: Pick<PublicReview, "rating">[]
): Record<string, unknown> | null {
  const valid = manual.filter((r) => Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5);
  if (valid.length === 0) return null;
  const avg = valid.reduce((s, r) => s + r.rating, 0) / valid.length;
  return {
    "@context": "https://schema.org",
    "@type": "AutoRental",
    name: company.name,
    url: company.url,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: Math.round(avg * 10) / 10,
      reviewCount: valid.length,
      bestRating: 5,
      worstRating: 1,
    },
  };
}
