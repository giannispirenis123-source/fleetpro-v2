// tests/vehicle-search.test.mjs
// Αναζήτηση οχήματος (src/lib/vehicleSearch.ts): πινακίδες με κενά/παύλες/
// τελείες/τόνους/ομοιόγραφα, μάρκα/μοντέλο. Τρέχει με `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { foldVehicleText, plateKey, searchVehicles, vehicleMatches } from "../src/lib/vehicleSearch.ts";

const yaris = { brand: "Toyota", model: "Yaris", plate: "ΧΑΝ-1234" };
const polo = { brand: "Volkswagen", model: "Polo", plate: "XAN 2345" }; // λατινικά
const octavia = { brand: "Škoda", model: "Octavia", plate: "ΗΡΚ.5555" };
const fleet = [yaris, polo, octavia];

test("plateKey: κενά, παύλες, τελείες, πεζά/κεφαλαία", () => {
  assert.equal(plateKey("ΧΑΝ1234"), plateKey("ΧΑΝ-1234"));
  assert.equal(plateKey("ΧΑΝ-1234"), plateKey("xan 1234"));
  assert.equal(plateKey("Χ.Α.Ν. 1234"), "xan1234");
});

test("plateKey: ελληνικά = λατινικά ομοιόγραφα (όλα τα 14)", () => {
  assert.equal(plateKey("ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ"), plateKey("ABEZHIKMNOPTYX"));
  assert.equal(plateKey("ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ"), "abezhikmnoptyx");
});

test("τόνοι και διακριτικά δεν μετρούν", () => {
  assert.equal(foldVehicleText("Ἀ ά Έ"), foldVehicleText("α α ε"));
  assert.equal(foldVehicleText("Škoda"), "skoda");
});

test("πινακίδα χωρίς παύλα, με ελληνικά ή λατινικά", () => {
  assert.equal(vehicleMatches(yaris, "XAN1234"), true); // λατινικά σε ελληνική πινακίδα
  assert.equal(vehicleMatches(yaris, "χαν 1234"), true);
  assert.equal(vehicleMatches(polo, "ΧΑΝ2345"), true); // ελληνικά σε λατινική πινακίδα
  assert.equal(vehicleMatches(octavia, "ηρκ5555"), true);
  assert.equal(vehicleMatches(yaris, "1234"), true);
  assert.equal(vehicleMatches(yaris, "2345"), false);
});

test("μάρκα / μοντέλο, πεζά-κεφαλαία, πολλές λέξεις", () => {
  assert.equal(vehicleMatches(yaris, "yaris"), true);
  assert.equal(vehicleMatches(yaris, "TOYOTA yar"), true);
  assert.equal(vehicleMatches(octavia, "skoda"), true);
  assert.equal(vehicleMatches(polo, "golf"), false);
});

test("ελάχιστο 1 χαρακτήρας· αποτελέσματα με όριο", () => {
  assert.deepEqual(searchVehicles(fleet, "o").map((v) => v.model), ["Yaris", "Polo", "Octavia"]);
  assert.equal(searchVehicles(fleet, "o", 2).length, 2);
  assert.equal(searchVehicles(fleet, "x").length, 2); // ΧΑΝ + XAN
});
