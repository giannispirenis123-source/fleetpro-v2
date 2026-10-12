// tests/entitlements.test.mjs
// Πακέτα (entitlements): src/lib/entitlementsCore.ts (καθαρή λογική).
// Τρέχει με `npm test` (node:test).

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEntitlements, checkLimit, MODULE_KEYS } from "../src/lib/entitlementsCore.ts";

// Ίδιες τιμές με το prisma/sql/20-plans-storefront.sql.
const PLANS = {
  dashboard: { key: "dashboard", name: "Dashboard", modules: { dashboard: true, publicSite: false }, limits: { maxUsers: 1, maxVehicles: null } },
  dashboard_site: { key: "dashboard_site", name: "Dashboard + Site", modules: { dashboard: true, publicSite: true }, limits: { maxUsers: null, maxVehicles: null } },
  full: { key: "full", name: "Full", modules: { dashboard: true, publicSite: true }, limits: { maxUsers: null, maxVehicles: null } },
};

/* ── Ενότητες ── */

test("«dashboard»: μόνο dashboard, χωρίς δημόσια σελίδα", () => {
  const e = resolveEntitlements(PLANS.dashboard, {});
  assert.equal(e.modules.dashboard, true);
  assert.equal(e.modules.publicSite, false);
});

test("«dashboard_site» και «full» έχουν publicSite", () => {
  assert.equal(resolveEntitlements(PLANS.dashboard_site, {}).modules.publicSite, true);
  assert.equal(resolveEntitlements(PLANS.full, {}).modules.publicSite, true);
});

test("ενότητα που λείπει από το πακέτο = κλειστή· μόνο το true ανοίγει", () => {
  const e = resolveEntitlements({ key: "x", modules: { dashboard: "yes", publicSite: 1 }, limits: {} }, {});
  assert.equal(e.modules.dashboard, false);
  assert.equal(e.modules.publicSite, false);
  const empty = resolveEntitlements({ key: "y", modules: {}, limits: {} }, {});
  for (const k of MODULE_KEYS) assert.equal(empty.modules[k], false);
});

/* ── Όρια ── */

test("null = απεριόριστο (και όταν το κλειδί λείπει)", () => {
  const e = resolveEntitlements(PLANS.full, {});
  assert.equal(e.limits.users, null);
  assert.equal(e.limits.vehicles, null);
  assert.equal(checkLimit(e, "vehicles", 10_000).ok, true);
  const missing = resolveEntitlements({ key: "m", modules: {}, limits: {} }, {});
  assert.equal(missing.limits.users, null);
});

test("όριο 1 χρήστη: ο πρώτος περνά, ο δεύτερος κόβεται με ελληνικό μήνυμα", () => {
  const e = resolveEntitlements(PLANS.dashboard, {});
  assert.equal(e.limits.users, 1);
  assert.equal(checkLimit(e, "users", 0).ok, true);
  const second = checkLimit(e, "users", 1);
  assert.equal(second.ok, false);
  assert.match(second.message, /έως 1 χρήστη/);
  assert.equal(checkLimit(e, "users", 5).ok, false, "ήδη πάνω από το όριο");
});

test("όριο 0 = δεν επιτρέπεται κανένα", () => {
  const e = resolveEntitlements({ key: "z", modules: {}, limits: { maxVehicles: 0 } }, {});
  const r = checkLimit(e, "vehicles", 0);
  assert.equal(r.ok, false);
  assert.match(r.message, /Δεν περιλαμβάνεται στο πακέτο σας/);
});

test("χαλασμένη τιμή ορίου (κείμενο/αρνητικό) αγνοείται → απεριόριστο", () => {
  const e = resolveEntitlements({ key: "b", modules: {}, limits: { maxUsers: "3", maxVehicles: -1 } }, {});
  assert.equal(e.limits.users, null);
  assert.equal(e.limits.vehicles, null);
});

/* ── Overrides ── */

test("override ανοίγει ενότητα που δεν έχει το πακέτο", () => {
  const e = resolveEntitlements(PLANS.dashboard, { modules: { publicSite: true } });
  assert.equal(e.modules.publicSite, true);
  assert.equal(e.modules.dashboard, true, "τα υπόλοιπα μένουν του πακέτου");
});

test("override κλείνει ενότητα του πακέτου", () => {
  const e = resolveEntitlements(PLANS.full, { modules: { publicSite: false } });
  assert.equal(e.modules.publicSite, false);
});

test("override ορίου: αριθμός ανεβάζει, null = απεριόριστο για αυτήν μόνο", () => {
  const more = resolveEntitlements(PLANS.dashboard, { limits: { maxUsers: 3 } });
  assert.equal(more.limits.users, 3);
  assert.equal(checkLimit(more, "users", 2).ok, true);
  assert.equal(checkLimit(more, "users", 3).ok, false);

  const unlimited = resolveEntitlements(PLANS.dashboard, { limits: { maxUsers: null } });
  assert.equal(unlimited.limits.users, null);
  assert.equal(checkLimit(unlimited, "users", 50).ok, true);

  const tighter = resolveEntitlements(PLANS.full, { limits: { maxVehicles: 2 } });
  assert.equal(tighter.limits.vehicles, 2);
  assert.equal(tighter.limits.users, null, "το άλλο όριο μένει του πακέτου");
});

test("άκυρα overrides (null, πίνακας, κείμενο) αγνοούνται", () => {
  for (const ov of [null, undefined, [], "x", { modules: [], limits: "y" }]) {
    const e = resolveEntitlements(PLANS.dashboard, ov);
    assert.equal(e.modules.publicSite, false);
    assert.equal(e.limits.users, 1);
  }
});

/* ── Εταιρία χωρίς πακέτο ── */

test("χωρίς πακέτο: καμία ενότητα, κανένας νέος χρήστης/όχημα", () => {
  const e = resolveEntitlements(null, {});
  assert.equal(e.planKey, null);
  for (const k of MODULE_KEYS) assert.equal(e.modules[k], false);
  assert.equal(e.limits.users, 0);
  assert.equal(e.limits.vehicles, 0);
  const r = checkLimit(e, "vehicles", 0);
  assert.equal(r.ok, false);
  assert.match(r.message, /δεν έχει ενεργό πακέτο/);
});

test("χωρίς πακέτο αλλά με override: ισχύει το override", () => {
  const e = resolveEntitlements(null, { modules: { dashboard: true }, limits: { maxUsers: 2 } });
  assert.equal(e.modules.dashboard, true);
  assert.equal(e.limits.users, 2);
  assert.equal(e.limits.vehicles, 0);
});
