// tests/card-crypto.test.mjs
// Πλήρης αριθμός κάρτας: καθαρισμός/έλεγχος (src/lib/cardNumber.ts) και
// AES-256-GCM (src/lib/cardCrypto.ts). Τρέχει με `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { groupCardNumber, maskedCardNumber, normalizeCardNumber } from "../src/lib/cardNumber.ts";
import {
  CardKeyError,
  cardKey,
  decryptCardNumber,
  encryptCardNumber,
  nextCardNumbersEnc,
  readCardNumbersEnc,
  storedCardNumbers,
} from "../src/lib/cardCrypto.ts";

const KEY_B64 = randomBytes(32).toString("base64");
const key = cardKey(KEY_B64);
const PAN = "4111111111111111";
const both = { payment: true, deposit: true };

test("normalizeCardNumber: κενά/παύλες, 13–19 ψηφία", () => {
  assert.equal(normalizeCardNumber("4111 1111-1111 1111"), PAN);
  assert.equal(normalizeCardNumber("4222222222222"), "4222222222222"); // 13
  assert.equal(normalizeCardNumber("1".repeat(19)), "1".repeat(19));
  assert.equal(normalizeCardNumber("1".repeat(12)), null);
  assert.equal(normalizeCardNumber("1".repeat(20)), null);
  assert.equal(normalizeCardNumber("4111 1111 1111 111a"), null);
});

test("μάσκα και ομαδοποίηση", () => {
  assert.equal(maskedCardNumber("1234"), "•••• •••• •••• 1234");
  assert.equal(groupCardNumber(PAN), "4111 1111 1111 1111");
});

test("cardKey: λείπει / λάθος μήκος → CardKeyError με καθαρό μήνυμα", () => {
  assert.throws(() => cardKey(""), (e) => e instanceof CardKeyError && /CARD_ENCRYPTION_KEY/.test(e.message));
  assert.throws(() => cardKey(randomBytes(16).toString("base64")), CardKeyError);
});

test("κρυπτογράφηση: round-trip, χωρίς τον αριθμό σε καθαρή μορφή, τυχαίο IV", () => {
  const a = encryptCardNumber(PAN, key);
  const b = encryptCardNumber(PAN, key);
  assert.ok(!a.includes(PAN));
  assert.notEqual(a, b);
  assert.equal(decryptCardNumber(a, key), PAN);
});

test("λάθος κλειδί ή πειραγμένο κείμενο → αποτυγχάνει", () => {
  const enc = encryptCardNumber(PAN, key);
  assert.throws(() => decryptCardNumber(enc, cardKey(randomBytes(32).toString("base64"))));
  const parts = enc.split(".");
  parts[3] = Buffer.from("0000000000000000").toString("base64url");
  assert.throws(() => decryptCardNumber(parts.join("."), key));
});

test("nextCardNumbersEnc: νέος, κρατιέται, διαγραφή, κάρτα που δεν ισχύει", () => {
  const first = nextCardNumbersEnc(null, { payment: PAN }, both, key);
  assert.deepEqual(storedCardNumbers(first), { payment: true, deposit: false });
  // Τίποτα νέο → ίδιο κρυπτογραφημένο, χωρίς κλειδί.
  assert.equal(nextCardNumbersEnc(first, {}, both), first);
  // Η εγγύηση με κάρτα: προστίθεται, η πληρωμή μένει.
  const second = nextCardNumbersEnc(first, { deposit: "5555555555554444" }, both, key);
  assert.equal(readCardNumbersEnc(second).payment, readCardNumbersEnc(first).payment);
  assert.equal(decryptCardNumber(readCardNumbersEnc(second).deposit, key), "5555555555554444");
  // Πληρωμή όχι πια με κάρτα → σβήνεται, χωρίς κλειδί.
  assert.deepEqual(storedCardNumbers(nextCardNumbersEnc(second, {}, { payment: false, deposit: true })), {
    payment: false,
    deposit: true,
  });
  // Ρητή διαγραφή και των δύο → null.
  assert.equal(nextCardNumbersEnc(second, { payment: null, deposit: null }, both), null);
});

test("νέος αριθμός χωρίς κλειδί → CardKeyError (όχι σιωπηλά)", () => {
  const saved = process.env.CARD_ENCRYPTION_KEY;
  delete process.env.CARD_ENCRYPTION_KEY;
  try {
    assert.throws(() => nextCardNumbersEnc(null, { payment: PAN }, both), CardKeyError);
  } finally {
    if (saved !== undefined) process.env.CARD_ENCRYPTION_KEY = saved;
  }
});

test("χαλασμένη στήλη → κενό, όχι σφάλμα", () => {
  assert.deepEqual(readCardNumbersEnc("όχι json"), {});
  assert.deepEqual(storedCardNumbers(null), { payment: false, deposit: false });
});
