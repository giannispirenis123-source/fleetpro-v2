// tests/places-reviews.test.mjs
// Δημόσιο site: «Μέρη για επίσκεψη» και «Κριτικές πελατών» (SQL 26).
// Φιλτράρισμα/σειρά, κρύψιμο, fallback γλώσσας, tenant isolation, Google με
// fallback, AggregateRating, DTO χωρίς ιδιωτικά πεδία. Χωρίς βάση/δίκτυο.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const {
  visiblePlaces, toPublicPlaceCard, toPublicPlace, findPublicPlace, placeSchema, placeToData, readPlaceDetails, suggestPlaceSlug, PLACE_SLUG_RE,
} = await import("../src/lib/public/places.ts");
const {
  reviewSchema, manualReviews, parseGooglePlace, fetchGooglePlace, buildReviewSection, aggregateRatingJsonLd, GOOGLE_FIELD_MASK, GOOGLE_REVALIDATE_SECONDS,
} = await import("../src/lib/public/reviews.ts");
const { placePhotoFolder, isPublicIdInFolder } = await import("../src/lib/vehiclePhotos.ts");
const { textFor } = await import("../src/lib/public/text.ts");

/* ─────────────────────────────────────────────
   Δεδομένα
   ───────────────────────────────────────────── */

const T = "tenantA";
const photo = (id, url, order) => ({ id, url, publicId: `fleetpro/${T}/places/x/${id}`, order });
const place = (slug, over = {}) => ({
  id: `id-${slug}`,
  tenantId: T,
  slug,
  nameI18n: { el: `Όνομα ${slug}`, en: `Name ${slug}` },
  shortI18n: { el: "Μία γραμμή" },
  descriptionI18n: { el: "Περιγραφή" },
  detailsI18n: [],
  mapUrl: null,
  coverImage: null,
  photos: [],
  allLocations: true,
  isActive: true,
  sortOrder: 0,
  locationIds: [],
  ...over,
});

const ROWS = [
  place("balos", { sortOrder: 2 }),
  place("elafonisi", { sortOrder: 1, allLocations: false, locationIds: ["LOC_AIRPORT"] }),
  place("old-town", { sortOrder: 0 }),
  place("souda-beach", { sortOrder: 3, allLocations: false, locationIds: ["LOC_PORT"] }),
  place("hidden", { isActive: false }),
  place("foreign", { tenantId: "tenantB" }),
];

/* ─────────────────────────────────────────────
   Μέρη
   ───────────────────────────────────────────── */

test("μέρη: χωρίς pl όλα τα ενεργά της εταιρίας, με τη σειρά τους", () => {
  assert.deepEqual(visiblePlaces(ROWS, T, null).map((p) => p.slug), ["old-town", "elafonisi", "balos", "souda-beach"]);
});

test("μέρη: με pl ΠΡΩΤΑ της τοποθεσίας, μετά τα «όλες»· άλλων τοποθεσιών όχι", () => {
  assert.deepEqual(visiblePlaces(ROWS, T, "LOC_AIRPORT").map((p) => p.slug), ["elafonisi", "old-town", "balos"]);
  assert.deepEqual(visiblePlaces(ROWS, T, "LOC_PORT").map((p) => p.slug), ["souda-beach", "old-town", "balos"]);
  // Τοποθεσία χωρίς δικά της μέρη: μόνο τα «όλες».
  assert.deepEqual(visiblePlaces(ROWS, T, "LOC_OTHER").map((p) => p.slug), ["old-town", "balos"]);
});

test("μέρη: μόνο ενεργά, μόνο της εταιρίας· κενό → η ενότητα κρύβεται", () => {
  const slugs = visiblePlaces(ROWS, T, null).map((p) => p.slug);
  assert.ok(!slugs.includes("hidden"));
  assert.ok(!slugs.includes("foreign"));
  assert.deepEqual(visiblePlaces([place("x", { isActive: false })], T, null), []);
  assert.deepEqual(visiblePlaces(ROWS, "tenantC", null), []);
  // Σελίδα μέρους: ανενεργό ή άλλης εταιρίας → null (404).
  assert.equal(findPublicPlace(ROWS, T, "hidden"), null);
  assert.equal(findPublicPlace(ROWS, T, "foreign"), null);
  assert.equal(findPublicPlace(ROWS, "tenantB", "foreign").slug, "foreign");
  assert.equal(findPublicPlace(ROWS, T, "balos").slug, "balos");
});

test("μέρη: fallback γλώσσας ζητούμενη → en → el → πρώτη", () => {
  const p = place("a", { nameI18n: { el: "Μπάλος" }, shortI18n: { en: "Lagoon" }, descriptionI18n: { de: "Lagune" } });
  assert.equal(toPublicPlaceCard(p, "en").name, "Μπάλος");
  assert.equal(toPublicPlaceCard(p, "el").short, "Lagoon");
  assert.equal(toPublicPlace(p, "fr").description, "Lagune");
  assert.equal(textFor({ en: "X", el: "Χ" }, "fr"), "X");
});

test("μέρη: DTO μόνο δημόσια πεδία· εξώφυλλο = πρώτη φωτογραφία κατά σειρά", () => {
  const p = place("balos", {
    photos: [photo("p2", "https://res.cloudinary.com/x/image/upload/v1/b.jpg", 1), photo("p1", "https://res.cloudinary.com/x/image/upload/v1/a.jpg", 0)],
    detailsI18n: [{ label: { el: "Είσοδος", en: "Entrance" }, value: { el: "2 €" } }, { label: { el: "μόνο ετικέτα" }, value: {} }],
    mapUrl: "https://maps.google.com/?q=balos",
  });
  const card = toPublicPlaceCard(p, "en");
  assert.deepEqual(Object.keys(card).sort(), ["coverUrl", "name", "short", "slug"]);
  assert.equal(card.coverUrl, "https://res.cloudinary.com/x/image/upload/v1/a.jpg");
  const full = toPublicPlace(p, "en");
  assert.deepEqual(Object.keys(full).sort(), ["coverUrl", "description", "details", "mapUrl", "name", "photos", "short", "slug"]);
  assert.deepEqual(full.details, [{ label: "Entrance", value: "2 €" }]);
  assert.equal(full.photos.length, 2);
  const json = JSON.stringify(full);
  for (const secret of ["tenantA", "id-balos", "publicId", "fleetpro/", "sortOrder", "isActive"]) assert.ok(!json.includes(secret), `διαρροή: ${secret}`);
  // Μη-https χάρτης δεν περνά.
  assert.equal(toPublicPlace(place("z", { mapUrl: "javascript:alert(1)" }), "el").mapUrl, null);
});

test("μέρη: σχήμα — slug, υποχρεωτικό όνομα, τοποθεσίες, στοιχεία, https χάρτης", () => {
  const ok = placeSchema.parse({ slug: " Balos-Lagoon ", nameI18n: { el: "Μπάλος" }, detailsI18n: [{ label: { el: "Ώρες" }, value: { el: "Όλη μέρα" } }, { label: {}, value: {} }] });
  assert.equal(ok.slug, "balos-lagoon");
  assert.equal(ok.detailsI18n.length, 1);
  assert.equal(ok.allLocations, true);
  for (const bad of ["Μπάλος", "a", "balos lagoon", "-balos", "balos--x", "balos_x"]) {
    assert.equal(placeSchema.safeParse({ slug: bad, nameI18n: { el: "Χ" } }).success, false, bad);
  }
  assert.equal(placeSchema.safeParse({ slug: "ok-1", nameI18n: { en: "X" } }).success, false, "ΕΛ όνομα υποχρεωτικό");
  assert.equal(placeSchema.safeParse({ slug: "ok-1", nameI18n: { el: "Χ" }, allLocations: false, locationIds: [] }).success, false);
  assert.equal(placeSchema.safeParse({ slug: "ok-1", nameI18n: { el: "Χ" }, mapUrl: "http://x.gr" }).success, false);
  assert.ok(PLACE_SLUG_RE.test(suggestPlaceSlug("Λιμνοθάλασσα Μπάλου")));
  assert.equal(suggestPlaceSlug("Λιμνοθάλασσα Μπάλου"), "limnothalassa-mpalou");
  assert.equal(suggestPlaceSlug("Παλιά Πόλη Χανίων!"), "palia-poli-chanion");
});

test("μέρη: αποθήκευση τοποθεσιών — «όλες» σβήνει τον περιορισμό, η αλλαγή αντικαθιστά", () => {
  const d = placeSchema.parse({ slug: "x-1", nameI18n: { el: "Χ" }, allLocations: false, locationIds: ["L1", "L2", "L1"] });
  assert.deepEqual(placeToData(d, "create").locations, { create: [{ pickupLocationId: "L1" }, { pickupLocationId: "L2" }] });
  assert.deepEqual(placeToData(d, "update").locations, { deleteMany: {}, create: [{ pickupLocationId: "L1" }, { pickupLocationId: "L2" }] });
  const all = placeSchema.parse({ slug: "x-1", nameI18n: { el: "Χ" }, allLocations: true, locationIds: ["L1"] });
  assert.deepEqual(placeToData(all, "update").locations, { deleteMany: {}, create: [] });
  assert.ok(!("locationIds" in placeToData(all, "create")));
});

test("μοναδικότητα slug ανά εταιρία + διαγραφή μέρους καθαρίζει place_locations (σχήμα & SQL)", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../prisma/sql/26-places-reviews.sql", import.meta.url), "utf8");
  const placeModel = schema.slice(schema.indexOf("model Place {"), schema.indexOf("model PlaceLocation {"));
  assert.match(placeModel, /@@unique\(\[tenantId, slug\]\)/);
  assert.match(placeModel, /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "places_tenantId_slug_key" ON "places" \("tenantId", "slug"\)/);
  const pl = schema.slice(schema.indexOf("model PlaceLocation {"), schema.indexOf("model Review {"));
  assert.match(pl, /place\s+Place\s+@relation\(fields: \[placeId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(sql, /"place_locations_placeId_fkey"[\s\S]*?ON DELETE CASCADE/);
  const rv = schema.slice(schema.indexOf("model Review {"));
  assert.match(rv, /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Cascade\)/);
});

test("φωτογραφίες: φάκελος fleetpro/{companyId}/places/{placeId}· ξένος φάκελος απορρίπτεται", () => {
  const folder = placePhotoFolder("tenantA", "place1");
  assert.equal(folder, "fleetpro/tenantA/places/place1");
  assert.ok(isPublicIdInFolder("fleetpro/tenantA/places/place1/abc123", folder));
  assert.equal(isPublicIdInFolder("fleetpro/tenantB/places/place1/abc123", folder), false);
  assert.equal(isPublicIdInFolder("fleetpro/tenantA/places/place2/abc123", folder), false);
  assert.equal(isPublicIdInFolder("fleetpro/tenantA/places/place1/../x", folder), false);
  assert.equal(placePhotoFolder("../x", "p"), null);
});

/* ─────────────────────────────────────────────
   Κριτικές
   ───────────────────────────────────────────── */

const review = (id, over = {}) => ({
  id, tenantId: T, authorName: `Πελάτης ${id}`, rating: 5, text: { el: "Τέλεια!", en: "Great!" },
  reviewDate: new Date(`2026-0${id.length}-01T00:00:00Z`), sourceUrl: null, isActive: true, sortOrder: 0, ...over,
});

const googleJson = {
  rating: 4.6,
  userRatingCount: 200,
  googleMapsUri: "https://maps.google.com/?cid=1",
  reviews: [
    { rating: 5, text: { text: "Translated" }, originalText: { text: "Πολύ καλή εξυπηρέτηση" }, authorAttribution: { displayName: "Maria K", uri: "https://www.google.com/maps/contrib/1" }, publishTime: "2026-09-01T10:00:00Z", googleMapsUri: "https://maps.google.com/review/1" },
    { rating: 4, text: { text: "Good" }, authorAttribution: { displayName: "John" }, publishTime: "2026-08-01T10:00:00Z" },
    { rating: 9, text: { text: "bad rating" }, authorAttribution: { displayName: "X" } },
    { rating: 5, authorAttribution: { displayName: "No text" } },
  ],
};

test("κριτικές: μόνο ενεργές της εταιρίας, fallback γλώσσας, σειρά", () => {
  const rows = [review("a", { sortOrder: 1 }), review("b", { sortOrder: 0, text: { el: "Μόνο ελληνικά" } }), review("c", { isActive: false }), review("d", { tenantId: "tenantB" })];
  const out = manualReviews(rows, T, "en");
  assert.deepEqual(out.map((r) => r.key), ["s:b", "s:a"]);
  assert.equal(out[0].text, "Μόνο ελληνικά", "en → el");
  assert.equal(out[1].text, "Great!");
  assert.deepEqual(Object.keys(out[0]).sort(), ["author", "authorUrl", "date", "key", "rating", "source", "sourceUrl", "text"]);
  assert.ok(!JSON.stringify(out).includes("tenant"));
});

test("κριτικές: σχήμα 1–5, κείμενο υποχρεωτικό, https πηγή", () => {
  const ok = reviewSchema.parse({ authorName: "Ελένη", rating: 4, text: { el: "Καλά" }, reviewDate: "2026-10-01" });
  assert.equal(ok.pickupLocationId, null);
  for (const r of [0, 6, 4.5]) assert.equal(reviewSchema.safeParse({ authorName: "X", rating: r, text: { el: "a" }, reviewDate: "2026-10-01" }).success, false);
  assert.equal(reviewSchema.safeParse({ authorName: "X", rating: 5, text: {}, reviewDate: "2026-10-01" }).success, false);
  assert.equal(reviewSchema.safeParse({ authorName: "X", rating: 5, text: { el: "a" }, reviewDate: "2026-10-01", sourceUrl: "http://x" }).success, false);
});

test("Google: ανάλυση απάντησης — αρχικό κείμενο χωρίς αλλοίωση, όνομα/link, έως 5, άκυρα έξω", () => {
  const g = parseGooglePlace(googleJson, "ChIJabcdefghij");
  assert.equal(g.rating, 4.6);
  assert.equal(g.count, 200);
  assert.equal(g.url, "https://maps.google.com/?cid=1");
  assert.deepEqual(g.reviews.map((r) => [r.author, r.rating, r.text, r.source]), [
    ["Maria K", 5, "Πολύ καλή εξυπηρέτηση", "google"],
    ["John", 4, "Good", "google"],
  ]);
  assert.equal(g.reviews[0].authorUrl, "https://www.google.com/maps/contrib/1");
  assert.equal(g.reviews[0].sourceUrl, "https://maps.google.com/review/1");
  assert.equal(g.reviews[1].sourceUrl, "https://maps.google.com/?cid=1", "χωρίς link κριτικής → link του σημείου");
  assert.equal(parseGooglePlace({ reviews: Array.from({ length: 9 }, () => googleJson.reviews[0]) }, "ChIJabcdefghij").reviews.length, 5);
  assert.equal(parseGooglePlace({}, "ChIJabcdefghij"), null);
  assert.equal(parseGooglePlace(null, "x"), null);
});

test("Google: fallback σιωπηλά — χωρίς κλειδί, χωρίς Place ID, σφάλμα, μη-200", async () => {
  let calls = 0;
  const okFetch = async (url, init) => {
    calls++;
    assert.match(url, /^https:\/\/places\.googleapis\.com\/v1\/places\/ChIJabcdefghij\?languageCode=el$/);
    assert.equal(init.headers["X-Goog-FieldMask"], GOOGLE_FIELD_MASK);
    assert.equal(init.next.revalidate, GOOGLE_REVALIDATE_SECONDS);
    return { ok: true, json: async () => googleJson };
  };
  assert.equal(await fetchGooglePlace("ChIJabcdefghij", "el", { apiKey: undefined, fetch: okFetch }), null);
  assert.equal(await fetchGooglePlace("ChIJabcdefghij", "el", { apiKey: "  ", fetch: okFetch }), null);
  assert.equal(await fetchGooglePlace(null, "el", { apiKey: "k", fetch: okFetch }), null);
  assert.equal(await fetchGooglePlace("bad id!", "el", { apiKey: "k", fetch: okFetch }), null);
  assert.equal(calls, 0, "χωρίς κλειδί/ID κανένα αίτημα");
  const errors = console.error;
  console.error = () => {};
  try {
    assert.equal(await fetchGooglePlace("ChIJabcdefghij", "el", { apiKey: "k", fetch: async () => { throw new Error("net"); } }), null);
    assert.equal(await fetchGooglePlace("ChIJabcdefghij", "el", { apiKey: "k", fetch: async () => ({ ok: false, json: async () => ({}) }) }), null);
  } finally {
    console.error = errors;
  }
  const g = await fetchGooglePlace("ChIJabcdefghij", "el", { apiKey: "k", fetch: okFetch });
  assert.equal(g.count, 200);
  assert.equal(calls, 1);
  // Ενότητα με αποτυχημένο Google = μόνο οι χειροκίνητες, χωρίς σφάλμα.
  const manual = manualReviews([review("a")], T, "el");
  const section = buildReviewSection(manual, [null, null]);
  assert.equal(section.count, 1);
  assert.equal(section.googleCount, 0);
  assert.deepEqual(section.reviews.map((r) => r.source), ["site"]);
});

test("ενότητα: συνολικό σκορ σταθμισμένο, και οι δύο πηγές· κενή → null (κρύβεται)", () => {
  assert.equal(buildReviewSection([], []), null);
  assert.equal(buildReviewSection([], [null]), null);
  const manual = manualReviews([review("a", { rating: 5 }), review("b", { rating: 3 })], T, "el");
  const g = parseGooglePlace(googleJson, "ChIJabcdefghij");
  const s = buildReviewSection(manual, [g]);
  assert.equal(s.count, 202);
  assert.equal(s.rating, Math.round(((4.6 * 200 + 8) / 202) * 10) / 10);
  assert.equal(s.googleCount, 200);
  assert.equal(s.siteCount, 2);
  assert.equal(s.googleUrl, "https://maps.google.com/?cid=1");
  assert.deepEqual(s.reviews.map((r) => r.source), ["site", "site", "google", "google"]);
  const onlySite = buildReviewSection(manual, []);
  assert.equal(onlySite.rating, 4);
  assert.equal(onlySite.googleUrl, null);
});

test("AggregateRating ΜΟΝΟ με πραγματικά (δικά μας) δεδομένα", () => {
  assert.equal(aggregateRatingJsonLd({ name: "Co", url: "https://x/s/co/el" }, []), null);
  assert.equal(aggregateRatingJsonLd({ name: "Co", url: "https://x" }, [{ rating: 0 }, { rating: 7 }]), null);
  const ld = aggregateRatingJsonLd({ name: "Co", url: "https://x/s/co/el" }, [{ rating: 5 }, { rating: 4 }]);
  assert.equal(ld["@context"], "https://schema.org");
  assert.deepEqual(ld.aggregateRating, { "@type": "AggregateRating", ratingValue: 4.5, reviewCount: 2, bestRating: 5, worstRating: 1 });
});

/* ─────────────────────────────────────────────
   Μόνο Διαχειριστής
   ───────────────────────────────────────────── */

test("μόνο Διαχειριστής (με publicSite) διαχειρίζεται μέρη/κριτικές — ίδιος φύλακας", async () => {
  const { storefrontAccess } = await import("../src/lib/storefront/admin.ts");
  for (const role of ["STAFF", "PARTNER", "SUPER_ADMIN"]) {
    const r = await storefrontAccess({ userId: "u", role, tenantId: role === "SUPER_ADMIN" ? null : "t1", permissions: { "settings.edit": true } });
    assert.equal(r.ok, false, role);
  }
  // Τα routes των μερών/κριτικών/φωτογραφιών περνούν ΟΛΑ από το withPublicSite.
  for (const f of [
    "../src/app/api/public-site/[resource]/route.ts",
    "../src/app/api/public-site/[resource]/[id]/route.ts",
    "../src/app/api/public-site/[resource]/[id]/move/route.ts",
    "../src/app/api/public-site/place-photos/[id]/route.ts",
    "../src/app/api/public-site/place-photos/[id]/sign/route.ts",
    "../src/app/api/public-site/place-photos/[id]/[photoId]/route.ts",
  ]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    const handlers = src.match(/export const (GET|POST|PATCH|DELETE) =/g) ?? [];
    const guarded = src.match(/export const (GET|POST|PATCH|DELETE) = withPublicSite\(/g) ?? [];
    assert.ok(handlers.length > 0 && handlers.length === guarded.length, f);
  }
});

test("readPlaceDetails: μόνο πλήρεις γραμμές, έως 20", () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ label: { el: `Ε${i}` }, value: { el: `Τ${i}` } }));
  assert.equal(readPlaceDetails(rows).length, 20);
  assert.deepEqual(readPlaceDetails("x"), []);
});

test("αρχική: σειρά hero → about → μέρη → κριτικές → οχήματα· κενές ενότητες κρυφές", () => {
  const src = readFileSync(new URL("../src/components/storefront/StorefrontViews.tsx", import.meta.url), "utf8");
  const home = src.slice(src.indexOf("export function StorefrontHome("), src.indexOf("export function", src.indexOf("export function StorefrontHome(") + 10));
  const at = (s) => {
    const i = home.indexOf(s);
    assert.ok(i >= 0, s);
    return i;
  };
  const order = ["<SearchBox", "sf-about", "<PlacesSection", "<ReviewsSection", "<Results"].map(at);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "σειρά ενοτήτων");
  const comp = readFileSync(new URL("../src/components/storefront/PlacesReviews.tsx", import.meta.url), "utf8");
  assert.match(comp, /if \(places\.length === 0\) return null;/, "κενά μέρη → τίποτα");
  assert.match(comp, /if \(!section \|\| section\.reviews\.length \+ section\.count === 0\) return null;/, "κενές κριτικές → τίποτα");
  // Οι εικόνες των καρτών φορτώνουν lazy (μόνο το hero eager).
  assert.match(comp, /loading="lazy"/);
  assert.doesNotMatch(comp, /loading="eager"/);
});

test("μέρη: όνομα μόνο στα ελληνικά → η κάρτα ΔΕΝ χάνεται σε άλλη γλώσσα του site", () => {
  const rows = [place("a", { nameI18n: { el: "Μπάλος" } }), place("b", { nameI18n: { el: "Ελαφονήσι", en: "Elafonisi" } })];
  for (const lang of ["el", "en", "fr", "pl"]) {
    const cards = visiblePlaces(rows, T, null).map((p) => toPublicPlaceCard(p, lang));
    assert.equal(cards.length, 2, lang);
    assert.ok(cards.every((c) => c.name.length > 0), lang);
  }
  assert.equal(toPublicPlaceCard(rows[1], "fr").name, "Elafonisi", "fr → en");
  assert.equal(toPublicPlaceCard(rows[0], "pl").name, "Μπάλος", "pl → el");
});
