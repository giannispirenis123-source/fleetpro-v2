// tests/card-photos-carousel.test.mjs
// Καρουζέλ στις κάρτες κατηγορίας του site — η ΣΥΛΛΟΓΗ φωτογραφιών:
//   · πρώτα της ομάδας, μετά των οχημάτων της, με σταθερή σειρά·
//   · χωρίς διπλές, μόνο https, έως 12·
//   · στον browser φεύγουν ΜΟΝΟ URLs (κανένα id/πινακίδα/κατάσταση).
// + κανόνες του component (4΄΄, reduced-motion, lazy, 1 φωτογραφία).
// Χωρίς βάση. Τρέχει με `npm test`.

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

const ROOT = new URL("../", import.meta.url).pathname;
const src = (p) => readFileSync(ROOT + p, "utf8");

const { buildCards, collectCardPhotos, CARD_PHOTOS_MAX } = await import("../src/lib/public/catalog.ts");

const U = (name) => `https://res.cloudinary.com/demo/image/upload/v1/${name}.jpg`;

const group = (id, code, photoUrls) => ({
  id,
  code,
  vehicleType: "car",
  name: { el: code },
  similarModels: {},
  seats: 5,
  doors: 5,
  transmission: "manual",
  fuel: "PETROL",
  bagsLarge: 0,
  bagsSmall: 0,
  airCondition: true,
  engineCc: null,
  photoUrl: photoUrls[0] ?? null,
  photoUrls,
  sortOrder: 0,
});

const vehicle = (id, rentalGroupId, photoUrls, extra = {}) => ({
  id,
  tenantId: "tenant_secret",
  rentalGroupId,
  brand: "Toyota",
  model: id,
  vehicleType: "car",
  seats: 5,
  doors: 5,
  transmission: "Manual",
  fuel: "PETROL",
  ac: true,
  photoUrl: photoUrls[0] ?? null,
  photoUrls,
  status: "AVAILABLE",
  isActive: true,
  plate: "XHA-1234",
  ...extra,
});

test("σειρά: πρώτα της ομάδας, μετά κάθε οχήματος με τη σειρά που δίνεται", () => {
  assert.deepEqual(collectCardPhotos([U("g1"), U("g2")], [[U("a1"), U("a2")], [U("b1")]]), [U("g1"), U("g2"), U("a1"), U("a2"), U("b1")]);
});

test("χωρίς διπλές (ίδιο URL σε ομάδα και όχημα, ή σε δύο οχήματα)", () => {
  assert.deepEqual(collectCardPhotos([U("g1")], [[U("g1"), U("a1")], [U("a1"), U("b1")]]), [U("g1"), U("a1"), U("b1")]);
});

test(`όριο ${CARD_PHOTOS_MAX} συνολικά — οι της ομάδας κρατιούνται πρώτες`, () => {
  assert.equal(CARD_PHOTOS_MAX, 12);
  const g = Array.from({ length: 5 }, (_, i) => U(`g${i}`));
  const members = Array.from({ length: 4 }, (_, v) => Array.from({ length: 3 }, (_, i) => U(`v${v}_${i}`)));
  const out = collectCardPhotos(g, members);
  assert.equal(out.length, 12);
  assert.deepEqual(out.slice(0, 5), g);
  assert.equal(out[11], U("v2_0"));
});

test("μόνο https URLs· σκουπίδια αγνοούνται", () => {
  assert.deepEqual(collectCardPhotos(["http://x/y.jpg", "", U("ok")], [[null, 42, "javascript:alert(1)"]]), [U("ok")]);
  assert.deepEqual(collectCardPhotos([], []), []);
});

test("κάρτα ομάδας: photos από ομάδα + οχήματα, photoUrl = η πρώτη", () => {
  const groups = [group("grp_secret_A", "A", [U("gA")]), group("grp_secret_B", "B", [])];
  const fleet = [
    vehicle("veh_a1", "grp_secret_A", [U("a1"), U("gA")]),
    vehicle("veh_a2", "grp_secret_A", [U("a2")]),
    vehicle("veh_b1", "grp_secret_B", []),
    // Ανενεργό όχημα: οι φωτογραφίες του ΔΕΝ μπαίνουν.
    vehicle("veh_a3", "grp_secret_A", [U("hidden")], { status: "INACTIVE" }),
  ];
  const [a, b] = buildCards(groups, fleet, "el");
  assert.deepEqual(a.photos, [U("gA"), U("a1"), U("a2")]);
  assert.equal(a.photoUrl, U("gA"));
  assert.deepEqual(b.photos, [], "καμία φωτογραφία → placeholder");
  assert.equal(b.photoUrl, null);
});

test("μία φωτογραφία → ένα στοιχείο (το component δεν δείχνει βελάκια/τελίτσες)", () => {
  const [card] = buildCards([group("g", "A", [])], [vehicle("v1", "g", [U("only")])], "el");
  assert.deepEqual(card.photos, [U("only")]);
  assert.match(src("src/components/storefront/CardCarousel.tsx"), /if \(n === 1\) return <Photo/);
});

test("ΚΑΜΙΑ διαρροή: στην κάρτα μόνο strings URLs — όχι ids, πινακίδες, κατάσταση", () => {
  const groups = [group("grp_secret_A", "A", [U("gA")])];
  const fleet = [vehicle("veh_secret_1", "grp_secret_A", [U("p1")]), vehicle("veh_secret_2", "grp_secret_A", [U("p2")])];
  const cards = buildCards(groups, fleet, "el");
  for (const c of cards) {
    assert.ok(c.photos.every((p) => typeof p === "string"), "photos: μόνο strings");
  }
  const json = JSON.stringify(cards);
  for (const secret of ["veh_secret_1", "veh_secret_2", "grp_secret_A", "tenant_secret", "XHA-1234", "AVAILABLE", "rentalGroupId", "tenantId", "plate", "publicId"]) {
    assert.ok(!json.includes(secret), `διαρροή: ${secret}`);
  }
});

test("site.ts: σταθερή σειρά οχημάτων (μάρκα, μοντέλο, id) και μόνο URLs από τη βάση", () => {
  const site = src("src/lib/public/site.ts");
  assert.match(site, /orderBy: \[\{ brand: "asc" \}, \{ model: "asc" \}, \{ id: "asc" \}\]/);
  assert.match(site, /photoUrls: readVehiclePhotos\(g\.photos\)\.map\(\(p\) => p\.url\)/);
  assert.match(site, /photoUrls: readVehiclePhotos\(v\.photos\)\.map\(\(p\) => p\.url\)/);
});

test("component: 4΄΄, χωρίς αυτόματη εναλλαγή με reduced-motion, lazy, παύση σε hover/αφή", () => {
  const c = src("src/components/storefront/CardCarousel.tsx");
  assert.match(c, /CAROUSEL_INTERVAL_MS = 4000/);
  assert.match(c, /prefers-reduced-motion: reduce/);
  assert.match(c, /stopped \|\| hovered \|\| !visible \|\| prefersReducedMotion\(\)/);
  assert.match(c, /new Set\(\[0\]\)/, "αρχικά φορτώνει μόνο η πρώτη");
  assert.match(c, /loaded\.has\(i\) \? <Photo/);
  assert.match(c, /onTouchStart=\{\(\) => setStopped\(true\)\}/);
  assert.match(c, /cloudinaryThumb\(url, 640\)/);
  // Βελάκια μόνο σε συσκευές με ποντίκι· στο κινητό swipe (scroll-snap).
  const css = src("src/components/storefront/storefront.css");
  assert.match(css, /scroll-snap-type: x mandatory/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.sf-car-arrow \{ display: grid; \}/);
});
