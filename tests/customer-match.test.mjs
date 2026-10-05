// tests/customer-match.test.mjs
// Αναγνώριση παλιού πελάτη (src/lib/customerMatch.ts): τόνοι/κεφαλαία,
// τηλέφωνο με κενά/+30, έγγραφα, διπλότυπα, συμπλήρωση πελάτη.
// Τρέχει με `npm test` (node:test).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FOLD_FROM,
  FOLD_TO,
  customerFromDriver,
  customerMatches,
  docKey,
  duplicateKeys,
  foldText,
  isDuplicateOf,
  missingCustomerFields,
  phoneDigits,
  searchQueryFor,
  splitFullName,
} from "../src/lib/customerMatch.ts";

const giannis = {
  firstName: "Γιάννης",
  lastName: "Παπαδόπουλος",
  phone: "+30 694 123 4567",
  phone2: null,
  email: "Giannis.P@Example.com",
  idNumber: "ΑΚ 123456",
  licenseNumber: "GR-998877",
  address: "Οδός Ελευθερίου Βενιζέλου 12",
  city: "Χανιά",
};

const match = (field, q, c = giannis) => {
  const query = searchQueryFor(field, q);
  return query !== null && customerMatches(c, field, query);
};

/* ── Κανονικοποίηση ── */

test("foldText: χωρίς τόνους, πεζά, τελικό σίγμα", () => {
  assert.equal(foldText("ΓΙΆΝΝΗΣ Παπαδόπουλος"), "γιαννησ παπαδοπουλοσ");
  assert.equal(foldText("Ευφροσύνη Ϊ ΐ"), "ευφροσυνη ι ι");
  assert.equal(foldText("José MÜLLER"), "jose muller");
});

test("FOLD_FROM/FOLD_TO: ίδιο μήκος (translate() της PostgreSQL)", () => {
  assert.equal(Array.from(FOLD_FROM).length, Array.from(FOLD_TO).length);
});

test("phoneDigits: κενά, παύλες, +30, 0030", () => {
  assert.equal(phoneDigits("+30 694 123 4567"), "6941234567");
  assert.equal(phoneDigits("0030-694-1234567"), "6941234567");
  assert.equal(phoneDigits("694 12 34 567"), "6941234567");
  assert.equal(phoneDigits("+44 7700 900123"), "447700900123");
});

test("docKey: ελληνικά = λατινικά που μοιάζουν, χωρίς κενά", () => {
  assert.equal(docKey("ΑΚ 123456"), docKey("ak123456"));
  assert.equal(docKey("AK-123456"), "ak123456");
});

/* ── Αναζήτηση ανά πεδίο ── */

test("όνομα: χωρίς τόνους και κεφαλαία", () => {
  assert.equal(match("name", "γιαννης"), true);
  assert.equal(match("name", "ΠΑΠΑΔΟΠΟΥΛΟΣ"), true);
  assert.equal(match("name", "Παπαδοπουλος γιαν"), true);
  assert.equal(match("name", "παπαδόπουλος"), true);
  assert.equal(match("name", "Νίκος"), false);
});

test("όνομα: ελάχιστο 2 χαρακτήρες", () => {
  assert.equal(searchQueryFor("name", "γ"), null);
  assert.notEqual(searchQueryFor("name", "γι"), null);
});

test("τηλέφωνο: με κενά, με/χωρίς +30, κομμάτι του αριθμού", () => {
  assert.equal(match("phone", "6941234567"), true);
  assert.equal(match("phone", "694 123"), true);
  assert.equal(match("phone", "+30 694 123 4567"), true);
  assert.equal(match("phone", "0030 6941234567"), true);
  assert.equal(match("phone", "697"), false);
});

test("τηλέφωνο: ελάχιστο 3 ψηφία", () => {
  assert.equal(searchQueryFor("phone", "69"), null);
  assert.notEqual(searchQueryFor("phone", "694"), null);
});

test("τηλέφωνο: βρίσκει και το δεύτερο τηλέφωνο", () => {
  assert.equal(match("phone", "2821012345", { ...giannis, phone2: "28210 12345" }), true);
});

test("email: χωρίς κεφαλαία", () => {
  assert.equal(match("email", "giannis.p@"), true);
  assert.equal(match("email", "EXAMPLE.COM"), true);
  assert.equal(match("email", "maria@"), false);
});

test("ταυτότητα / δίπλωμα: χωρίς κενά/παύλες, ελληνικά ή λατινικά", () => {
  assert.equal(match("idNumber", "ak123456"), true);
  assert.equal(match("idNumber", "ΑΚ123"), true);
  assert.equal(match("licenseNumber", "gr998"), true);
  assert.equal(match("licenseNumber", "998877"), true);
  assert.equal(match("licenseNumber", "123456"), false);
});

test("διεύθυνση: και στην πόλη, χωρίς τόνους", () => {
  assert.equal(match("address", "βενιζελου"), true);
  assert.equal(match("address", "χανια"), true);
  assert.equal(match("address", "Ηρακλειο"), false);
});

/* ── Διπλότυπα ── */

test("διπλότυπο: ίδιο τηλέφωνο με άλλη μορφή", () => {
  assert.equal(isDuplicateOf(giannis, { phone: "6941234567", email: "" }), true);
  assert.equal(isDuplicateOf(giannis, { phone: "0030 694 1234567", email: "" }), true);
});

test("διπλότυπο: ίδιο email με άλλα κεφαλαία", () => {
  assert.equal(isDuplicateOf(giannis, { phone: "", email: "giannis.p@example.COM " }), true);
});

test("όχι διπλότυπο: άλλο τηλέφωνο/email, ή πολύ λίγα ψηφία", () => {
  assert.equal(isDuplicateOf(giannis, { phone: "6977777777", email: "other@example.com" }), false);
  assert.equal(isDuplicateOf(giannis, { phone: "4567", email: "" }), false);
  assert.deepEqual(duplicateKeys("4567", ""), { phone: "", email: "" });
});

/* ── Κύριος οδηγός → πελάτης ── */

const driver = {
  fullName: "  Maria   Del Carmen  Lopez ",
  country: "ES",
  licenseNumber: "X123",
  licenseExpiry: "2030-01-31",
  birthDate: "1990-05-02",
  idNumber: "",
  phone: "+34 600 000 000",
  email: "maria@example.com",
  address: "Calle 1, Madrid",
};

test("splitFullName: πρώτη λέξη όνομα, οι υπόλοιπες επώνυμο", () => {
  assert.deepEqual(splitFullName("Γιάννης Παπαδόπουλος"), { firstName: "Γιάννης", lastName: "Παπαδόπουλος" });
  assert.deepEqual(splitFullName("Cher"), { firstName: "Cher", lastName: "" });
});

test("customerFromDriver: μόνο πεδία του Customer, κενά → null", () => {
  const c = customerFromDriver(driver);
  assert.equal(c.firstName, "Maria");
  assert.equal(c.lastName, "Del Carmen Lopez");
  assert.equal(c.idNumber, null);
  assert.equal(c.licenseCountry, "ES");
  assert.equal(c.dateOfBirth, "1990-05-02");
  assert.equal("signature" in c, false);
});

test("missingCustomerFields: συμπληρώνει ΜΟΝΟ τα κενά, ποτέ αντικατάσταση", () => {
  const out = missingCustomerFields(
    { phone: "6941111111", email: null, idNumber: "", licenseNumber: "OLD", address: null },
    customerFromDriver(driver)
  );
  assert.deepEqual(out, {
    email: "maria@example.com",
    licenseExpiry: "2030-01-31",
    dateOfBirth: "1990-05-02",
    address: "Calle 1, Madrid",
  });
});
