// tests/storefront-slug.test.mjs
// Slug της δημόσιας σελίδας: src/lib/storefront/slug.ts. Τρέχει με `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSlug,
  checkSlugAvailability,
  storefrontPath,
  RESERVED_SLUGS,
} from "../src/lib/storefront/slug.ts";

test("έγκυρα slugs", () => {
  for (const s of ["abc", "p-rentals", "chania-cars-2", "a1b", "x".repeat(40)]) {
    assert.equal(validateSlug(s).ok, true, s);
  }
});

test("κανονικοποίηση: κενά άκρων και κεφαλαία", () => {
  const r = validateSlug("  Chania-Cars ");
  assert.equal(r.ok, true);
  assert.equal(r.slug, "chania-cars");
});

test("μήκος 3–40", () => {
  assert.equal(validateSlug("ab").reason, "length");
  assert.equal(validateSlug("").reason, "length");
  assert.equal(validateSlug("x".repeat(41)).reason, "length");
});

test("μορφή: μόνο a-z, 0-9, παύλα — όχι στην αρχή/τέλος/διπλή", () => {
  for (const s of ["-abc", "abc-", "ab--cd", "ab_cd", "ab cd", "ab.cd", "αβγδ", "ab/cd", "ab%2f", "café"]) {
    const r = validateSlug(s);
    assert.equal(r.ok, false, s);
    assert.equal(r.reason, "format", s);
  }
});

test("δεσμευμένα: login, dashboard, api, c, admin, s κλπ.", () => {
  for (const s of ["login", "dashboard", "api", "admin", "super-admin", "print", "www"]) {
    const r = validateSlug(s);
    assert.equal(r.ok, false, s);
    assert.equal(r.reason, "reserved", s);
  }
  // Τα 1-2 γραμμάτων (c, s, el, en) κόβονται ήδη από το μήκος· είναι και στη λίστα.
  for (const s of ["c", "s", "el", "en"]) {
    assert.ok(RESERVED_SLUGS.has(s), s);
    assert.equal(validateSlug(s).ok, false, s);
  }
  assert.equal(validateSlug("LOGIN").reason, "reserved", "και με κεφαλαία");
});

test("μοναδικότητα: slug άλλης εταιρίας → taken", () => {
  const r = checkSlugAvailability("chania-cars", "tenant_b", "tenant_a");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "taken");
});

test("μοναδικότητα: η εταιρία κρατά το δικό της / ελεύθερο slug περνά", () => {
  assert.equal(checkSlugAvailability("chania-cars", "tenant_a", "tenant_a").ok, true);
  assert.equal(checkSlugAvailability("chania-cars", null, "tenant_a").ok, true);
});

test("μοναδικότητα: η μορφή ελέγχεται πρώτη", () => {
  assert.equal(checkSlugAvailability("api", null, "tenant_a").reason, "reserved");
});

test("διευθύνσεις: η προεπιλεγμένη γλώσσα χωρίς πρόθεμα", () => {
  assert.equal(storefrontPath("chania-cars", "el", "el"), "/s/chania-cars");
  assert.equal(storefrontPath("chania-cars", "en", "el"), "/s/chania-cars/en");
  assert.equal(storefrontPath("chania-cars", "en", "el", "veh1"), "/s/chania-cars/en/v/veh1");
  assert.equal(storefrontPath("chania-cars", "el", "el", "veh1"), "/s/chania-cars/v/veh1");
});
