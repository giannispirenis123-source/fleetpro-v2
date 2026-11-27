// tests/request-vehicle-page.test.mjs
// Η παλιά σελίδα μεμονωμένου οχήματος (/s/<slug>/<lang>/v/<id> και το
// redirect /s/<slug>/v/<id>):
//   · REQUEST → 404 (ούτε σελίδα, ούτε τίτλος με μάρκα/μοντέλο, ούτε redirect)·
//   · BOOKING → κανονική σελίδα, όπως πριν.
// Χωρίς βάση. Τρέχει με `npm test`.

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

const { vehiclePageVisible } = await import("../src/lib/public/requestPrivacy.ts");

test("REQUEST: η σελίδα οχήματος ΔΕΝ υπάρχει (404)", () => {
  assert.equal(vehiclePageVisible("REQUEST"), false);
});

test("BOOKING (και παλιά εγγραφή χωρίς τιμή): κανονική σελίδα", () => {
  assert.equal(vehiclePageVisible("BOOKING"), true);
  assert.equal(vehiclePageVisible(null), true);
  assert.equal(vehiclePageVisible(undefined), true);
});

/** Το σώμα μιας συνάρτησης του routes.tsx, ως την επόμενη `export`. */
const bodyOf = (file, name) => {
  const s = src(file);
  const start = s.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `λείπει η ${name}`);
  const end = s.indexOf("\nexport ", start + 1);
  return s.slice(start, end < 0 ? undefined : end);
};

test("σελίδα και metadata: ο έλεγχος γίνεται ΠΡΙΝ φορτωθεί το όχημα", () => {
  for (const name of ["StorefrontVehiclePage", "storefrontVehicleMetadata"]) {
    const body = bodyOf("src/lib/storefront/routes.tsx", name);
    const guard = body.indexOf("if (!vehiclePageVisible(company.rentalMode)) notFound();");
    const load = body.indexOf("loadPublicVehicle(");
    assert.ok(guard > 0, `${name}: λείπει ο έλεγχος REQUEST`);
    assert.ok(load > guard, `${name}: το όχημα φορτώνεται μόνο ΜΕΤΑ τον έλεγχο`);
  }
});

test("redirect χωρίς γλώσσα (/s/<slug>/v/<id>): 404 σε REQUEST, χωρίς redirect", () => {
  const body = bodyOf("src/lib/storefront/page.ts", "redirectToDefaultLanguage");
  const guard = body.indexOf("if (vehicleId && !vehiclePageVisible(company.rentalMode)) notFound();");
  assert.ok(guard > 0);
  assert.ok(body.indexOf("redirect(sitePath(") > guard);
});

test("οι άλλες δημόσιες διαδρομές απορρίπτουν ήδη το v.<id> σε REQUEST (κατάλογος PR 72)", () => {
  const guard = 'key.startsWith("v.") && !cat.vehicles.some((v) => v.id === key.slice(2) && !v.rentalGroupId)';
  // Τιμή φόρμας / κωδικός έκπτωσης / υποβολή (publicFormQuote), κάρτες και τιμή κάρτας (site.ts).
  assert.ok(src("src/lib/public/bookingSubmit.ts").includes(guard));
  assert.equal(src("src/lib/public/site.ts").split(guard).length - 1, 2);
  // Ο κατάλογος σε REQUEST δεν έχει οχήματα χωρίς ομάδα.
  assert.match(src("src/lib/public/site.ts"), /siteVehiclesForMode\(tenant\.rentalMode, vehicles\)/);
});
