// tests/storefront-visibility.test.mjs
// Πότε η δημόσια σελίδα είναι ανοιχτή (visibility.ts) και πώς βρίσκεται από το
// URL (slug.ts): ταίριασμα slug, 404 μόνο στις τρεις περιπτώσεις, redirect
// παλιών διευθύνσεων, μη έγκυρη γλώσσα. Τρέχει με `npm test`.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const { storefrontVisibility, storefrontRowVisibility, HIDDEN_REASON_TEXT } = await import("../src/lib/storefront/visibility.ts");
const { canonicalSlug, canonicalSitePath, chooseLanguage, normalizeSlug, validateSlug, storefrontPath } = await import(
  "../src/lib/storefront/slug.ts"
);

const PLAN_FULL = { key: "full", name: "Full", modules: { dashboard: true, publicSite: true }, limits: {} };
const PLAN_DASH = { key: "dashboard", name: "Dashboard", modules: { dashboard: true }, limits: { maxUsers: 1 } };

const row = (extra = {}) => ({
  storefrontSlug: "fleet-pro-chania",
  storefrontEnabled: true,
  status: "ACTIVE",
  entitlementPlan: PLAN_FULL,
  entitlementOverrides: {},
  ...extra,
});

/* ── Ταίριασμα slug ── */

test("slug: κεφαλαία, κενά, τόνοι και %20 → κανονική μορφή", () => {
  assert.equal(canonicalSlug("fleet-pro-chania"), "fleet-pro-chania");
  assert.equal(canonicalSlug("Fleet-Pro-Chania"), "fleet-pro-chania");
  assert.equal(canonicalSlug("  fleet-pro-chania "), "fleet-pro-chania");
  assert.equal(canonicalSlug("%20Fleet-Pro-Chania%20"), "fleet-pro-chania");
  assert.equal(canonicalSlug("fléet-pro-chaniá"), "fleet-pro-chania");
  assert.equal(canonicalSlug("ενοικιάσεις"), null, "ελληνικά δεν γίνονται slug");
  assert.equal(canonicalSlug("fleet pro"), null);
  assert.equal(canonicalSlug("api"), null, "δεσμευμένο");
  assert.equal(canonicalSlug("%E0%A4%A"), null, "χαλασμένο encoding");
});

test("middleware: διαδρομή με μη κανονικό slug/γλώσσα → redirect στην κανονική", () => {
  assert.equal(canonicalSitePath("/s/Fleet-Pro-Chania"), "/s/fleet-pro-chania");
  assert.equal(canonicalSitePath("/s/Fleet-Pro-Chania/EL/search"), "/s/fleet-pro-chania/el/search");
  assert.equal(canonicalSitePath("/s/fleet-pro-chania/EN"), "/s/fleet-pro-chania/en");
  assert.equal(canonicalSitePath("/s/fleet-pro-chania/el"), null, "ήδη κανονική");
  assert.equal(canonicalSitePath("/s/fleet-pro-chania/el/v/AbC123"), null, "το id οχήματος δεν πειράζεται");
  assert.equal(canonicalSitePath("/s/ελληνικά/el"), null, "δεν σώζεται → 404 από τη σελίδα");
  assert.equal(canonicalSitePath("/dashboard"), null);
});

test("φόρμα: μόνο μικρά λατινικά/αριθμοί/παύλα, καθαρό ελληνικό μήνυμα", () => {
  assert.equal(normalizeSlug(" Fleet-Pro "), "fleet-pro");
  assert.equal(validateSlug("café").ok, false, "η φόρμα δεν δέχεται τόνους (μόνο το URL τους ανέχεται)");
  const bad = validateSlug("Ενοικιάσεις Χανιά");
  assert.equal(bad.ok, false);
  assert.match(bad.message, /μικρά λατινικά/);
  assert.equal(validateSlug("ab").reason, "length");
  assert.equal(validateSlug("a--b-c").reason, "format");
});

/* ── 404 / 200: ΜΙΑ πηγή αλήθειας ── */

test("άγνωστο slug → κλειστή (404)", () => {
  assert.deepEqual(storefrontRowVisibility(null), { open: false, reason: "unknown_slug" });
});

test("ανενεργή σελίδα → κλειστή (404)", () => {
  assert.deepEqual(storefrontRowVisibility(row({ storefrontEnabled: false })), { open: false, reason: "disabled" });
});

test("χωρίς publicSite στο πακέτο → κλειστή (404)· override ανοίγει", () => {
  assert.deepEqual(storefrontRowVisibility(row({ entitlementPlan: PLAN_DASH })), { open: false, reason: "no_public_site" });
  assert.deepEqual(storefrontRowVisibility(row({ entitlementPlan: null })), { open: false, reason: "no_public_site" });
  assert.deepEqual(
    storefrontRowVisibility(row({ entitlementPlan: PLAN_DASH, entitlementOverrides: { modules: { publicSite: true } } })),
    { open: true },
    "δώρο μέσω entitlementOverrides"
  );
  assert.deepEqual(
    storefrontRowVisibility(row({ entitlementOverrides: { modules: { publicSite: false } } })),
    { open: false, reason: "no_public_site" }
  );
});

test("ενεργή με publicSite → ανοιχτή (200)", () => {
  assert.deepEqual(storefrontRowVisibility(row()), { open: true });
  assert.deepEqual(storefrontRowVisibility(row({ status: "TRIAL" })), { open: true }, "δοκιμαστική εταιρία");
});

test("ανασταλμένη/ακυρωμένη ή χωρίς slug → κλειστή", () => {
  assert.equal(storefrontRowVisibility(row({ status: "SUSPENDED" })).reason, "suspended");
  assert.equal(storefrontRowVisibility(row({ status: "CANCELLED" })).reason, "suspended");
  assert.equal(storefrontVisibility({ storefrontSlug: null, storefrontEnabled: true, status: "ACTIVE", publicSite: true }).reason, "no_slug");
});

test("κάθε λόγος έχει μήνυμα για τον Διαχειριστή (ΕΛ/EN)", () => {
  for (const r of ["unknown_slug", "no_slug", "disabled", "no_public_site", "suspended"]) {
    assert.ok(HIDDEN_REASON_TEXT[r].el && HIDDEN_REASON_TEXT[r].en, r);
  }
});

/* ── Γλώσσα και παλιές διευθύνσεις ── */

test("γλώσσα: υποστηριζόμενη → ίδια· /gr → el· άγνωστη → προεπιλογή (όχι 404)", () => {
  assert.deepEqual(chooseLanguage("el", ["el", "en"], "el"), { ok: true, lang: "el" });
  assert.deepEqual(chooseLanguage("en", ["el", "en"], "el"), { ok: true, lang: "en" });
  assert.deepEqual(chooseLanguage("gr", ["el", "en"], "el"), { ok: false, redirectTo: "el" });
  assert.deepEqual(chooseLanguage("fr", ["el", "en"], "el"), { ok: false, redirectTo: "el" });
  assert.deepEqual(chooseLanguage("en", ["el"], "el"), { ok: false, redirectTo: "el" }, "EN απενεργοποιημένα");
  assert.deepEqual(chooseLanguage("gr", ["en"], "en"), { ok: false, redirectTo: "en" });
  assert.deepEqual(chooseLanguage(undefined, ["el", "en"], "en"), { ok: false, redirectTo: "en" });
});

test("παλιές διευθύνσεις: προορισμός redirect στην προεπιλεγμένη γλώσσα", () => {
  // /s/<slug> → /s/<slug>/<default>, /s/<slug>/v/<id> → /s/<slug>/<default>/v/<id>
  assert.equal(storefrontPath("fleet-pro-chania", "el"), "/s/fleet-pro-chania/el");
  assert.equal(storefrontPath("fleet-pro-chania", "el", { vehicleId: "seed_veh_1" }), "/s/fleet-pro-chania/el/v/seed_veh_1");
  // Μη έγκυρη γλώσσα στην αναζήτηση: ίδια σελίδα, ίδια κριτήρια.
  assert.equal(
    storefrontPath("fleet-pro-chania", chooseLanguage("gr", ["el", "en"], "el").redirectTo, "search", "from=2026-10-21T10%3A00"),
    "/s/fleet-pro-chania/el/search?from=2026-10-21T10%3A00"
  );
});
