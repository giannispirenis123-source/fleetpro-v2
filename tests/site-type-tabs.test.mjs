// tests/site-type-tabs.test.mjs
// Καρτέλες τύπου οχήματος στο δημόσιο site (πάνω από τη φόρμα αναζήτησης):
//   · φαίνονται ΜΟΝΟ τύποι με κάρτες· ένας τύπος → καμία καρτέλα·
//   · προεπιλογή: Αυτοκίνητα, αλλιώς ο πρώτος τύπος με κάρτες·
//   · ?type= από το URL κρατιέται, αν ο τύπος έχει κάρτες·
//   · φιλτράρισμα των καρτών ανά τύπο·
//   · BOOKING: όχημα χωρίς ομάδα πάει στον τύπο του (Vehicle.vehicleType,
//     όχι το παλιό enum category)· REQUEST: μόνο κατηγορίες.
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

const { activeType, buildCards, filterByType, siteVehiclesForMode, typeTabs } = await import("../src/lib/public/catalog.ts");

const group = (id, code, vehicleType) => ({
  id,
  code,
  vehicleType,
  name: { el: code, en: code },
  similarModels: {},
  seats: 5,
  doors: 5,
  transmission: "manual",
  fuel: "PETROL",
  bagsLarge: 0,
  bagsSmall: 0,
  airCondition: true,
  engineCc: null,
  photoUrl: null,
  sortOrder: 0,
});

const vehicle = (id, rentalGroupId, vehicleType, extra = {}) => ({
  id,
  tenantId: "T1",
  rentalGroupId,
  brand: "B",
  model: id,
  vehicleType,
  seats: 2,
  doors: 0,
  transmission: "Manual",
  fuel: "PETROL",
  ac: false,
  photoUrl: null,
  status: "AVAILABLE",
  isActive: true,
  ...extra,
});

const card = (key, type) => ({ key, type });

test("μόνο τύποι με κάρτες, με σειρά Αυτοκίνητα → Μηχανές → ATV", () => {
  assert.deepEqual(typeTabs([card("g.Q", "atv"), card("g.A", "car")]), ["car", "atv"]);
  assert.deepEqual(typeTabs([card("g.M", "moto"), card("g.Q", "atv"), card("g.A", "car")]), ["car", "moto", "atv"]);
});

test("ένας τύπος (ή κανένας) → καμία καρτέλα και κανένα φίλτρο", () => {
  const cars = [card("g.A", "car"), card("g.B", "car")];
  assert.deepEqual(typeTabs(cars), []);
  assert.equal(activeType(cars, "moto"), null);
  assert.equal(activeType(cars, null), null);
  assert.equal(filterByType(cars, activeType(cars, null)).length, 2);
  assert.deepEqual(typeTabs([]), []);
  assert.equal(activeType([], null), null);
});

test("προεπιλογή: Αυτοκίνητα, αλλιώς ο πρώτος τύπος με κάρτες", () => {
  const all = [card("g.Q", "atv"), card("g.M", "moto"), card("g.A", "car")];
  assert.equal(activeType(all, null), "car");
  const noCars = [card("g.Q", "atv"), card("g.M", "moto")];
  assert.equal(activeType(noCars, null), "moto");
});

test("?type= από το URL: κρατιέται αν έχει κάρτες, αλλιώς προεπιλογή", () => {
  const all = [card("g.M", "moto"), card("g.A", "car")];
  assert.equal(activeType(all, "moto"), "moto");
  assert.equal(activeType(all, "atv"), "car", "τύπος χωρίς κάρτες → προεπιλογή");
});

test("φιλτράρισμα: η ενεργή καρτέλα δείχνει μόνο τις κάρτες του τύπου της", () => {
  const all = [card("g.A", "car"), card("g.M", "moto"), card("g.B", "car")];
  assert.deepEqual(filterByType(all, activeType(all, null)).map((c) => c.key), ["g.A", "g.B"]);
  assert.deepEqual(filterByType(all, activeType(all, "moto")).map((c) => c.key), ["g.M"]);
});

test("BOOKING: όχημα χωρίς ομάδα πάει στον τύπο του (vehicleType, όχι category)", () => {
  const groups = [group("gA", "A", "car")];
  // category "C" (παλιό enum) δεν παίζει ρόλο — μετρά μόνο το vehicleType.
  const fleet = [vehicle("yaris", "gA", "car"), vehicle("sh125", null, "moto", { category: "C" })];
  const cards = buildCards(groups, siteVehiclesForMode("BOOKING", fleet), "el");
  assert.deepEqual(typeTabs(cards), ["car", "moto"]);
  assert.deepEqual(filterByType(cards, "moto").map((c) => c.key), ["v.sh125"]);
});

test("REQUEST: τα οχήματα χωρίς ομάδα δεν δίνουν καρτέλα", () => {
  const groups = [group("gA", "A", "car")];
  const fleet = [vehicle("yaris", "gA", "car"), vehicle("sh125", null, "moto")];
  const cards = buildCards(groups, siteVehiclesForMode("REQUEST", fleet), "el");
  assert.deepEqual(typeTabs(cards), [], "μένει μόνο ένας τύπος → καμία καρτέλα");
});

test("οι καρτέλες είναι ΠΑΝΩ από τη φόρμα, και στην αρχική και στην αναζήτηση", () => {
  const views = src("src/components/storefront/StorefrontViews.tsx");
  assert.equal((views.match(/<TypeTabs tabs=\{tabs\} initial=\{type\} d=\{d\} \/>\s*<SearchBox/g) ?? []).length, 2);
  // Η ενεργή καρτέλα πηγαίνει και στη φόρμα (η αναζήτηση κρατά τον τύπο).
  assert.match(src("src/components/storefront/SearchBox.tsx"), /addEventListener\(TYPE_EVENT/);
  // Το URL κρατά τον τύπο (?type=) για link και refresh.
  assert.match(src("src/components/storefront/TypeTabs.tsx"), /searchParams\.set\("type", type\)/);
});
