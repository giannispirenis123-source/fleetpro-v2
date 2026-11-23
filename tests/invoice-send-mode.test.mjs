// tests/invoice-send-mode.test.mjs — «Αποστολή τιμολογίου: Αυτόματα» δεν
// στέλνει τίποτα ακόμα: δεν επιλέγεται, ο server δεν τη δέχεται, και παλιό
// αποθηκευμένο AUTO φαίνεται ως χειροκίνητο.

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

const I = await import("../src/lib/invoices.ts");
const { z } = await import("zod");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("server: δεκτό ΜΟΝΟ το MANUAL· το AUTO απορρίπτεται με σαφές μήνυμα", () => {
  assert.deepEqual([...I.INVOICE_SEND_MODES_AVAILABLE], ["MANUAL"]);
  const schema = z.object({ invoiceSendMode: z.enum(I.INVOICE_SEND_MODES_AVAILABLE).optional() });
  assert.equal(schema.safeParse({ invoiceSendMode: "MANUAL" }).success, true);
  assert.equal(schema.safeParse({ invoiceSendMode: "AUTO" }).success, false);
  assert.equal(schema.safeParse({}).success, true, "άλλες ρυθμίσεις αποθηκεύονται κανονικά");
  const route = read("src/app/api/settings/route.ts");
  assert.match(route, /\.enum\(INVOICE_SEND_MODES_AVAILABLE,/);
  assert.match(route, /e\.path\[0\] === "invoiceSendMode"\)\) return badRequest\(SEND_MODE_UNAVAILABLE\);/);
  assert.doesNotMatch(route, /z\.enum\(INVOICE_SEND_MODES\)/);
  assert.ok(route.indexOf("return badRequest(SEND_MODE_UNAVAILABLE)") < route.indexOf("invoiceSendMode: parsed.data.invoiceSendMode"));
});

test("παλιό αποθηκευμένο AUTO → φαίνεται ως χειροκίνητο (API και σελίδα)", () => {
  for (const v of ["AUTO", "MANUAL", null, undefined]) assert.equal(I.effectiveSendMode(v), "MANUAL");
  assert.match(read("src/app/api/settings/route.ts"), /invoiceSendMode: effectiveSendMode\(t\.invoiceSendMode\)/);
  assert.match(read("src/app/(dashboard)/dashboard/settings/page.tsx"), /initialSendMode=\{effectiveSendMode\(tenant\.invoiceSendMode\)\}/);
});

test("οθόνη: «Αυτόματα» disabled με ένδειξη «σύντομα», δεν στέλνει αίτημα, δεν φαίνεται επιλεγμένο", () => {
  const ui = read("src/app/(dashboard)/dashboard/settings/SettingsClient.tsx");
  assert.match(ui, /const SEND_SOON: Record<string, boolean> = \{ MANUAL: false, AUTO: true \};/);
  assert.match(ui, /disabled=\{soon \|\| Boolean\(savingInvoice\)\}/);
  assert.match(ui, /onClick=\{\(\) => !soon && saveInvoiceSetting\("invoiceSendMode", value\)\}/);
  assert.match(ui, /const active = !soon && \(sendMode === value \|\| sendMode === "AUTO"\);/);
  assert.match(ui, /\{soon && <span className="dash-soon">\{tr\("common\.comingSoon"\)\}<\/span>\}/);
  assert.match(read("src/lib/i18n/el.ts"), /sendAUTOHelp: "Δεν είναι ακόμα διαθέσιμο\./);
  assert.match(read("src/lib/i18n/en.ts"), /sendAUTOHelp: "Not available yet\./);
});
