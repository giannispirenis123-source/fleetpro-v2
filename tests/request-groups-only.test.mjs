// tests/request-groups-only.test.mjs
// Δημόσιο site ανά τρόπο κράτησης:
//   · REQUEST → ΜΟΝΟ κάρτες κατηγορίας ("g.<code>")· οχήματα χωρίς ομάδα δεν
//     εμφανίζονται και δεν δέχονται αίτημα ("v.<id>").
//   · BOOKING → όπως πριν (ομάδες + μεμονωμένα οχήματα).
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

const { buildCards, siteVehiclesForMode } = await import("../src/lib/public/catalog.ts");

const group = (id, code, extra = {}) => ({
  id,
  code,
  vehicleType: "car",
  name: { el: `Ομάδα ${code}`, en: `Group ${code}` },
  similarModels: {},
  seats: 5,
  doors: 5,
  transmission: "manual",
  fuel: "PETROL",
  bagsLarge: 1,
  bagsSmall: 1,
  airCondition: true,
  engineCc: null,
  photoUrl: null,
  sortOrder: 0,
  ...extra,
});

const vehicle = (id, rentalGroupId, extra = {}) => ({
  id,
  tenantId: "T1",
  rentalGroupId,
  brand: "Toyota",
  model: id,
  vehicleType: "car",
  seats: 5,
  doors: 5,
  transmission: "Manual",
  fuel: "PETROL",
  ac: true,
  photoUrl: null,
  status: "AVAILABLE",
  isActive: true,
  ...extra,
});

const GROUPS = [group("gC", "C")];
const FLEET = [
  vehicle("yaris", "gC"),
  vehicle("polo", "gC"),
  vehicle("i20", "gC"),
  vehicle("rav4", null),
  vehicle("octavia", null),
];

const keysFor = (mode) => buildCards(GROUPS, siteVehiclesForMode(mode, FLEET), "el").map((c) => c.key).sort();

test("REQUEST: μία κάρτα κατηγορίας, καμία κάρτα μεμονωμένου οχήματος", () => {
  assert.deepEqual(keysFor("REQUEST"), ["g.C"]);
});

test("BOOKING: όπως πριν — κατηγορία + οχήματα χωρίς ομάδα", () => {
  assert.deepEqual(keysFor("BOOKING"), ["g.C", "v.octavia", "v.rav4"]);
  // Χωρίς τιμή (παλιά εγγραφή) = BOOKING.
  assert.deepEqual(buildCards(GROUPS, siteVehiclesForMode(null, FLEET), "el").length, 3);
});

test("οχήματα της ίδιας ομάδας γίνονται ΜΙΑ κάρτα και στους δύο τρόπους", () => {
  for (const mode of ["REQUEST", "BOOKING"]) {
    const cards = buildCards(GROUPS, siteVehiclesForMode(mode, FLEET), "el").filter((c) => c.key.startsWith("g."));
    assert.equal(cards.length, 1);
  }
});

test("REQUEST χωρίς καμία ομάδα → κανένα όχημα στο site", () => {
  const ungrouped = FLEET.map((v) => ({ ...v, rentalGroupId: null }));
  assert.deepEqual(buildCards(GROUPS, siteVehiclesForMode("REQUEST", ungrouped), "el"), []);
});

test("ο κατάλογος του site εφαρμόζει τον κανόνα στο ΕΝΑ σημείο φόρτωσης", () => {
  const site = src("src/lib/public/site.ts");
  assert.match(site, /rentalMode: true/);
  assert.match(site, /siteVehiclesForMode\(tenant\.rentalMode, vehicles\)/);
  // Αίτημα για "v.<id>" απορρίπτεται, γιατί το όχημα λείπει από τον κατάλογο.
  assert.match(src("src/lib/public/bookingSubmit.ts"), /key\.startsWith\("v\."\) && !cat\.vehicles\.some/);
});
