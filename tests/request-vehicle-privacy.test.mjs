// tests/request-vehicle-privacy.test.mjs
// Λειτουργία REQUEST: ο πελάτης δεν βλέπει ΠΟΤΕ το όχημα που ανατέθηκε
// προσωρινά στο PENDING (σελίδα επιβεβαίωσης + email) — μόνο την κατηγορία.
// Στο BOOKING και σε κράτηση χωρίς ομάδα τίποτα δεν αλλάζει. Χωρίς βάση.

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

const { hidesAssignedVehicle, requestGroupName, requestGroupPhoto } = await import("../src/lib/public/requestPrivacy.ts");

const photo = (url) => [{ id: url, url, publicId: `p/${url}`, order: 0 }];

test("κρύβεται ΜΟΝΟ σε REQUEST με ομάδα", () => {
  assert.equal(hidesAssignedVehicle("REQUEST", true), true);
  assert.equal(hidesAssignedVehicle("REQUEST", false), false);
  assert.equal(hidesAssignedVehicle("BOOKING", true), false);
  assert.equal(hidesAssignedVehicle(null, true), false);
});

test("όνομα: της ομάδας, αλλιώς ο κωδικός — ποτέ μάρκα/μοντέλο", () => {
  assert.equal(requestGroupName({ name: { el: "Οικονομικά", en: "Economy" }, code: "A" }, "en"), "Economy");
  assert.equal(requestGroupName({ name: {}, code: "SUV" }, "el"), "SUV");
});

test("φωτογραφία: της ομάδας, αλλιώς των οχημάτων της με σταθερή σειρά", () => {
  const g = "https://res.cloudinary.com/x/g.jpg";
  const v1 = "https://res.cloudinary.com/x/v1.jpg";
  const v2 = "https://res.cloudinary.com/x/v2.jpg";
  assert.equal(requestGroupPhoto(photo(g), [photo(v1)]), g);
  assert.equal(requestGroupPhoto([], [[], photo(v1), photo(v2)]), v1);
  assert.equal(requestGroupPhoto([], []), null);
});

test("η σελίδα επιβεβαίωσης και το email περνούν από τον κανόνα του REQUEST", () => {
  const lookup = src("src/lib/public/bookingLookup.ts");
  assert.match(lookup, /hidesAssignedVehicle\(tenant\.rentalMode/);
  assert.match(lookup, /requestGroupPhoto\(g\.photos, members/);
  const decision = src("src/lib/bookingDecisionServer.ts");
  assert.match(decision, /hidesAssignedVehicle\(b\.tenant\.rentalMode/);
  assert.match(decision, /rentalMode: true/);
});
