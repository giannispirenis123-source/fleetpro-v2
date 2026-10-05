// tests/license-photos.test.mjs
// Φωτογραφίες διπλώματος: νέα μορφή (πίνακας) + συμβατότητα με τα παλιά
// { front, back } — src/lib/contracts.ts (μετατροπή κατά την ανάγνωση).
// Τρέχει με `npm test` (node:test).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LICENSE_PHOTOS,
  licenseLockOf,
  licensePathsOf,
  readDrivers,
  readLicensePhotos,
} from "../src/lib/contracts.ts";

const OLD_FRONT = "t1/c1/licenses/d1-front-AAAAAAAAAAAAAAAA.jpg";
const OLD_BACK = "t1/c1/licenses/d1-back-BBBBBBBBBBBBBBBB.jpg";
const NEW_1 = "t1/c1/licenses/d1-CCCCCCCCCCCCCCCC.jpg";

test("παλιό { front, back } → [front, back] (πρώτες στη λίστα)", () => {
  assert.deepEqual(readLicensePhotos({ front: OLD_FRONT, back: OLD_BACK }), [OLD_FRONT, OLD_BACK]);
});

test("παλιό μόνο back ή μόνο front", () => {
  assert.deepEqual(readLicensePhotos({ back: OLD_BACK }), [OLD_BACK]);
  assert.deepEqual(readLicensePhotos({ front: OLD_FRONT }), [OLD_FRONT]);
});

test("νέα μορφή: πίνακας με τη σειρά λήψης", () => {
  assert.deepEqual(readLicensePhotos([OLD_FRONT, OLD_BACK, NEW_1]), [OLD_FRONT, OLD_BACK, NEW_1]);
});

test("κενά/άκυρα → undefined, διπλότυπα αφαιρούνται", () => {
  assert.equal(readLicensePhotos(undefined), undefined);
  assert.equal(readLicensePhotos({}), undefined);
  assert.equal(readLicensePhotos([]), undefined);
  assert.equal(readLicensePhotos({ front: "", back: 5 }), undefined);
  assert.deepEqual(readLicensePhotos([NEW_1, NEW_1, 3, null]), [NEW_1]);
});

test("readDrivers: παλιός οδηγός με front/back δουλεύει κανονικά", () => {
  const [d] = readDrivers([
    { id: "d1", fullName: "Γιάννης", licensePhotos: { front: OLD_FRONT, back: OLD_BACK } },
  ]);
  assert.deepEqual(d.licensePhotos, [OLD_FRONT, OLD_BACK]);
  assert.equal(d.fullName, "Γιάννης");
});

test("readDrivers: οδηγός χωρίς φωτογραφίες δεν έχει καν το πεδίο", () => {
  const [d] = readDrivers([{ id: "d2", fullName: "Maria" }]);
  assert.equal("licensePhotos" in d, false);
});

test("licensePathsOf: παλιές και νέες διαδρομές όλων των οδηγών (για signed URL / διαγραφή)", () => {
  const drivers = readDrivers([
    { id: "d1", licensePhotos: { front: OLD_FRONT, back: OLD_BACK } },
    { id: "d2", licensePhotos: [NEW_1] },
    { id: "d3" },
  ]);
  assert.deepEqual(licensePathsOf(drivers), [OLD_FRONT, OLD_BACK, NEW_1]);
});

test("όριο: 4 φωτογραφίες ανά οδηγό", () => {
  assert.equal(MAX_LICENSE_PHOTOS, 4);
});

test("κλείδωμα: ανέβασμα μέχρι την ολοκλήρωση, διαγραφή μόνο πριν την πρώτη υπογραφή", () => {
  const unsigned = [{ id: "d1", signature: null }];
  const signed = [{ id: "d1", signature: "data:image/png;base64,AA" }];
  assert.equal(licenseLockOf("upload", "DRAFT", unsigned), null);
  assert.equal(licenseLockOf("delete", "DRAFT", unsigned), null);
  assert.equal(licenseLockOf("upload", "SIGNED", signed), null);
  assert.equal(licenseLockOf("delete", "DRAFT", signed), "signed");
  assert.equal(licenseLockOf("delete", "SIGNED", signed), "signed");
  assert.equal(licenseLockOf("upload", "COMPLETED", signed), "completed");
});
