// tests/price-override.test.mjs
// Χειροκίνητη τελική τιμή (src/lib/priceOverride.ts): διαφορά από την
// υπολογισμένη, ΦΠΑ από την τελική, καμία στρογγυλοποίηση, 403/409,
// μόνο ποσό + λόγος από τον client, επαναφορά. Τρέχει με `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computedTotalOf,
  decidePriceOverride,
  manualRentalOf,
  overrideIsStale,
  readPriceOverride,
  toRentalOverride,
  totalWithRental,
  validManualPrice,
  withManualRental,
} from "../src/lib/priceOverride.ts";
import { register } from "node:module";

// Ο ΙΔΙΟΣ κώδικας ΦΠΑ με την εφαρμογή (invoices.ts → "./pricing" χωρίς
// κατάληξη): μικρός resolver που δοκιμάζει και ".ts" για σχετικά imports.
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);
const { splitVatInclusive } = await import("../src/lib/invoices.ts");

const parts = { subtotal: 100.4, extrasTotal: 10, insuranceCost: 24, discountAmount: 5 }; // ακριβές 129,40
const base = {
  canPrice: true,
  lock: null,
  parts,
  roundUpTotal: true,
  actor: { userId: "u1", userName: "Γιάννης" },
  now: new Date("2026-10-05T10:00:00.000Z"),
};

test("υπολογισμένη τιμή: με και χωρίς στρογγυλοποίηση", () => {
  assert.equal(computedTotalOf(parts, false), 129.4);
  assert.equal(computedTotalOf(parts, true), 130);
});

/* ── Χειροκίνητο ενοίκιο + πρόσθετα ── */

// Ενοίκιο 50 € (υπολογισμένο) → 60 € (χειροκίνητο). Πρόσθετα με ΦΠΑ.
const noExtras = { subtotal: 50, extrasTotal: 0, insuranceCost: 0, discountAmount: 0 };
const sum = (b) => Math.round((b.subtotal + b.extrasTotal + b.insuranceCost - b.discountAmount) * 100) / 100;

test("χειροκίνητο ενοίκιο χωρίς πρόσθετα: σύνολο = ενοίκιο", () => {
  const d = decidePriceOverride({ ...base, parts: noExtras, requested: { rental: 60 } });
  assert.equal(d.ok, true);
  assert.equal(d.total, 60);
  assert.equal(d.override.manualRental, 60);
  assert.equal(d.override.computedRental, 50);
});

test("χειροκίνητο ενοίκιο + ένα πρόσθετο: το πρόσθετο προστίθεται", () => {
  const gps = { ...noExtras, extrasTotal: 15 };
  assert.equal(totalWithRental(gps, 60), 75);
  const shown = withManualRental(gps, 60);
  assert.deepEqual([shown.subtotal, shown.extrasTotal, shown.total], [60, 15, 75]);
  assert.equal(sum(shown), shown.total); // οι γραμμές αθροίζουν ακριβώς
});

test("χειροκίνητο ενοίκιο + πολλά πρόσθετα + ασφάλεια + έκπτωση", () => {
  // GPS 15 + επιπλέον οδηγός 20 + παιδικό κάθισμα 12,50 = 47,50· ασφάλεια 30· έκπτωση 5
  const many = { subtotal: 50, extrasTotal: 47.5, insuranceCost: 30, discountAmount: 5 };
  const d = decidePriceOverride({ ...base, parts: many, requested: { rental: 60 } });
  assert.equal(d.total, 132.5); // 60 + 47,50 + 30 − 5
  const shown = withManualRental(many, 60);
  assert.equal(shown.total, 132.5);
  assert.equal(sum(shown), 132.5);
});

test("αφαίρεση πρόσθετου: το σύνολο πέφτει, το ενοίκιο μένει", () => {
  const before = { ...noExtras, extrasTotal: 35, insuranceCost: 30 };
  const after = { ...noExtras, extrasTotal: 15, insuranceCost: 30 }; // βγήκε ο επιπλέον οδηγός (20)
  assert.equal(totalWithRental(before, 60), 125);
  assert.equal(totalWithRental(after, 60), 105);
  assert.equal(withManualRental(after, 60).subtotal, 60);
});

test("χωρίς χειροκίνητη τιμή: ο αυτόματος υπολογισμός ως έχει (με στρογγυλοποίηση)", () => {
  const d = decidePriceOverride({ ...base, requested: null });
  assert.deepEqual([d.ok, d.total, d.override], [true, 130, null]); // 129,40 → 130
  assert.equal(manualRentalOf(undefined, parts), undefined);
});

test("ΚΑΜΙΑ στρογγυλοποίηση με χειροκίνητο ενοίκιο (roundUpTotal on)", () => {
  const d = decidePriceOverride({ ...base, requested: { rental: 99.99 } });
  assert.equal(d.total, 128.99); // 99,99 + 10 + 24 − 5
});

test("σύνολο ≤ 0 (έκπτωση μεγαλύτερη από όλα) → 400", () => {
  const big = { subtotal: 50, extrasTotal: 0, insuranceCost: 0, discountAmount: 80 };
  assert.equal(decidePriceOverride({ ...base, parts: big, requested: { rental: 10 } }).status, 400);
});

/* ── Παλιά μορφή (τελικό σύνολο): ίδιο σύνολο, μετά τα πρόσθετα προστίθενται ── */

test("παλιά μορφή: μετατροπή σε ενοίκιο με τις γραμμές που ίσχυαν", () => {
  const old = { manualTotal: 110, computedTotal: 130, diff: -20, userName: "Γ", reason: "r" };
  // Γραμμές μαζί με το 110: πρόσθετα 10 + ασφάλεια 24 − έκπτωση 5 = 29 → ενοίκιο 81
  assert.equal(manualRentalOf(old, parts), 81);
  const converted = toRentalOverride(old, parts);
  assert.deepEqual(converted, { manualRental: 81, userName: "Γ", reason: "r" });
  // Σήμερα: ΙΔΙΟ σύνολο.
  assert.equal(totalWithRental(parts, 81), 110);
  // Μετά: νέο πρόσθετο 15 → 125.
  assert.equal(totalWithRental({ ...parts, extrasTotal: 25 }, 81), 125);
});

test("ΦΠΑ από το σύνολο: net = total / (1 + ΦΠΑ/100)", () => {
  const v = splitVatInclusive(124, 24);
  assert.equal(v.net, 100);
  assert.equal(v.vatAmount, 24);
  assert.equal(v.total, 124);
});

test("403 χωρίς contracts.price — πριν από κάθε άλλο έλεγχο", () => {
  const d = decidePriceOverride({ ...base, canPrice: false, lock: "signed", requested: { rental: 50 } });
  assert.deepEqual([d.ok, d.status], [false, 403]);
});

test("409 μετά την υπογραφή, με τιμολόγιο, με κλειστή κράτηση", () => {
  for (const lock of ["signed", "invoiced", "closed"]) {
    const d = decidePriceOverride({ ...base, lock, requested: { rental: 50 } });
    assert.deepEqual([d.ok, d.status], [false, 409], lock);
  }
  // Και η επαναφορά κλειδώνει το ίδιο.
  assert.equal(decidePriceOverride({ ...base, lock: "invoiced", requested: null }).status, 409);
});

test("μη έγκυρα ποσά → 400", () => {
  for (const rental of [0, -5, 10.123, NaN, 2_000_000]) {
    assert.equal(decidePriceOverride({ ...base, requested: { rental } }).status, 400, String(rental));
  }
  assert.equal(decidePriceOverride({ ...base, requested: { rental: 10, reason: "x".repeat(201) } }).status, 400);
  assert.equal(validManualPrice(10.1), true);
  assert.equal(validManualPrice(10.105), false);
});

test("μόνο ενοίκιο + λόγος από τον client· τα υπόλοιπα από τον server", () => {
  const d = decidePriceOverride({
    ...base,
    // Ο client «στέλνει» και άλλα πεδία — αγνοούνται (στον server τα κόβει και το strict zod).
    requested: { rental: 70, reason: "  ok  ", total: 1, computedRental: 999, userId: "hacker" },
  });
  assert.equal(d.total, 99); // 70 + 29
  assert.equal(d.override.computedRental, 100.4);
  assert.equal(d.override.userId, "u1");
  assert.equal(d.override.userName, "Γιάννης");
  assert.equal(d.override.reason, "ok");
  assert.equal(d.override.at, "2026-10-05T10:00:00.000Z");
});

test("προειδοποίηση όταν το υπολογισμένο ενοίκιο άλλαξε (ημερομηνίες/όχημα)", () => {
  const o = { manualRental: 60, computedRental: 50 };
  assert.equal(overrideIsStale(o, 50), false);
  assert.equal(overrideIsStale(o, 75), true);
});

test("ανάγνωση: νέα και παλιά μορφή, άκυρα → undefined", () => {
  assert.deepEqual(readPriceOverride({ manualRental: 60, computedRental: 50, reason: "r" }).manualRental, 60);
  assert.equal(readPriceOverride({ manualTotal: 110 }).manualTotal, 110);
  assert.equal(readPriceOverride({ manualTotal: 0 }), undefined);
  assert.equal(readPriceOverride({ manualRental: -1 }), undefined);
  assert.equal(readPriceOverride(null), undefined);
});
