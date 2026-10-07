// tests/contract-locations.test.mjs
// Σημεία παραλαβής/επιστροφής (src/lib/contractLocations.ts): βασικά
// σημεία πρώτα, σημεία συμβολαίων κατά συχνότητα, χωρίς διπλότυπα.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOCATIONS, locationKey, mergeLocations } from "../src/lib/contractLocations.ts";

test("χωρίς συμβόλαια: μόνο τα βασικά σημεία", () => {
  assert.deepEqual(mergeLocations([]), [...DEFAULT_LOCATIONS]);
});

test("σημεία συμβολαίων μετά τα βασικά, πιο συχνά πρώτα", () => {
  const out = mergeLocations([
    { value: "Πλατανιάς", count: 2 },
    { value: "Κίσσαμος", count: 5 },
  ]);
  assert.deepEqual(out.slice(DEFAULT_LOCATIONS.length), ["Κίσσαμος", "Πλατανιάς"]);
});

test("διπλότυπα με τόνους/κεφαλαία/κενά: μία φορά", () => {
  const out = mergeLocations([
    { value: "  αεροδρομιο  χανιων ", count: 9 },
    { value: "Κίσσαμος", count: 3 },
    { value: "ΚΙΣΣΑΜΟΣ", count: 1 },
  ]);
  assert.equal(out.filter((v) => locationKey(v) === locationKey("Αεροδρόμιο Χανίων")).length, 1);
  assert.equal(out.filter((v) => locationKey(v) === "κισσαμοσ").length, 1);
  assert.ok(out.includes("Κίσσαμος"));
});

test("κενά και null αγνοούνται", () => {
  const out = mergeLocations([
    { value: null, count: 10 },
    { value: "   ", count: 4 },
  ]);
  assert.deepEqual(out, [...DEFAULT_LOCATIONS]);
});
