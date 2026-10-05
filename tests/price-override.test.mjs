// tests/price-override.test.mjs
// Χειροκίνητη τελική τιμή (src/lib/priceOverride.ts): διαφορά από την
// υπολογισμένη, ΦΠΑ από την τελική, καμία στρογγυλοποίηση, 403/409,
// μόνο ποσό + λόγος από τον client, επαναφορά. Τρέχει με `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjustmentOf,
  computedTotalOf,
  decidePriceOverride,
  overrideIsStale,
  publicPriceOverride,
  readPriceOverride,
  validManualTotal,
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

test("μικρότερη τιμή: διαφορά από την υπολογισμένη και προσαρμογή γραμμών", () => {
  const d = decidePriceOverride({ ...base, requested: { total: 110, reason: "Τακτικός πελάτης" } });
  assert.equal(d.ok, true);
  assert.equal(d.total, 110);
  assert.equal(d.override.computedTotal, 130);
  assert.equal(d.override.diff, -20);
  assert.equal(adjustmentOf(parts, 110), -19.4); // γραμμές 129,40 + (−19,40) = 110
});

test("μεγαλύτερη τιμή επιτρέπεται", () => {
  const d = decidePriceOverride({ ...base, requested: { total: 150.55 } });
  assert.equal(d.ok, true);
  assert.equal(d.override.diff, 20.55);
  assert.equal(adjustmentOf(parts, 150.55), 21.15);
});

test("ΚΑΜΙΑ στρογγυλοποίηση πάνω στη χειροκίνητη τιμή (roundUpTotal on)", () => {
  const d = decidePriceOverride({ ...base, requested: { total: 99.99 } });
  assert.equal(d.total, 99.99);
});

test("ΦΠΑ από την τελική τιμή: net = total / (1 + ΦΠΑ/100)", () => {
  const v = splitVatInclusive(124, 24);
  assert.equal(v.net, 100);
  assert.equal(v.vatAmount, 24);
  assert.equal(v.total, 124);
});

test("403 χωρίς contracts.price — πριν από κάθε άλλο έλεγχο", () => {
  const d = decidePriceOverride({ ...base, canPrice: false, lock: "signed", requested: { total: 50 } });
  assert.deepEqual([d.ok, d.status], [false, 403]);
});

test("409 μετά την υπογραφή, με τιμολόγιο, με κλειστή κράτηση", () => {
  for (const lock of ["signed", "invoiced", "closed"]) {
    const d = decidePriceOverride({ ...base, lock, requested: { total: 50 } });
    assert.deepEqual([d.ok, d.status], [false, 409], lock);
  }
  // Και η επαναφορά κλειδώνει το ίδιο.
  assert.equal(decidePriceOverride({ ...base, lock: "invoiced", requested: null }).status, 409);
});

test("μη έγκυρα ποσά → 400", () => {
  for (const total of [0, -5, 10.123, NaN, 2_000_000]) {
    assert.equal(decidePriceOverride({ ...base, requested: { total } }).status, 400, String(total));
  }
  assert.equal(decidePriceOverride({ ...base, requested: { total: 10, reason: "x".repeat(201) } }).status, 400);
  assert.equal(validManualTotal(10.1), true);
  assert.equal(validManualTotal(10.105), false);
});

test("μόνο ποσό + λόγος από τον client· τα υπόλοιπα από τον server", () => {
  const d = decidePriceOverride({
    ...base,
    // Ο client «στέλνει» και άλλα πεδία — αγνοούνται (στον server τα κόβει και το strict zod).
    requested: { total: 100, reason: "  ok  ", computedTotal: 1, diff: 999, userId: "hacker" },
  });
  assert.equal(d.override.computedTotal, 130);
  assert.equal(d.override.diff, -30);
  assert.equal(d.override.userId, "u1");
  assert.equal(d.override.userName, "Γιάννης");
  assert.equal(d.override.reason, "ok");
  assert.equal(d.override.at, "2026-10-05T10:00:00.000Z");
});

test("επαναφορά: null → η υπολογισμένη τιμή, χωρίς override", () => {
  const d = decidePriceOverride({ ...base, requested: null });
  assert.deepEqual([d.ok, d.total, d.override], [true, 130, null]);
});

test("προειδοποίηση όταν η υπολογισμένη άλλαξε μετά την αλλαγή τιμής", () => {
  const o = { manualTotal: 110, computedTotal: 130 };
  assert.equal(overrideIsStale(o, 130), false);
  assert.equal(overrideIsStale(o, 145), true);
});

test("σελίδα πελάτη: μόνο το ποσό — όχι ποιος/γιατί/διαφορά", () => {
  const full = readPriceOverride({ manualTotal: 110, computedTotal: 130, diff: -20, userId: "u1", userName: "Γ", reason: "r", at: "x" });
  assert.deepEqual(publicPriceOverride(full), { manualTotal: 110 });
  assert.equal(readPriceOverride({ manualTotal: 0 }), undefined);
  assert.equal(readPriceOverride(null), undefined);
});
