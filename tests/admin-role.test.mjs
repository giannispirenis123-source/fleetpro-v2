// tests/admin-role.test.mjs
// Πολλοί διαχειριστές εταιρίας — δικλείδες (src/lib/adminRole.ts).
// Τρέχει με `npm test` (node:test).

import { test } from "node:test";
import assert from "node:assert/strict";
import { canChangeRole, canCreateWithRole, canDeactivate } from "../src/lib/adminRole.ts";

const T = "tenant_a";
const admin = { id: "admin1", role: "COMPANY_ADMIN", tenantId: T };
const admin2 = { id: "admin2", role: "COMPANY_ADMIN", tenantId: T, isActive: true };
const staffActor = { id: "staff1", role: "STAFF", tenantId: T };
const superAdmin = { id: "sa", role: "SUPER_ADMIN", tenantId: null };
const staffTarget = { id: "staff2", role: "STAFF", tenantId: T, isActive: true };
const partnerTarget = { id: "p1", role: "PARTNER", tenantId: T, isActive: true };
const foreignStaff = { id: "staffX", role: "STAFF", tenantId: "tenant_b", isActive: true };

/* ── Δεύτερος διαχειριστής ── */

test("διαχειριστής φτιάχνει ΔΕΥΤΕΡΟ διαχειριστή", () => {
  assert.equal(canCreateWithRole(admin, "COMPANY_ADMIN").ok, true);
});

test("διαχειριστής προάγει Προσωπικό σε διαχειριστή (υπάρχει ήδη ένας)", () => {
  assert.equal(canChangeRole(admin, staffTarget, { role: "COMPANY_ADMIN" }, 1).ok, true);
});

test("ο Συνεργάτης δεν γίνεται διαχειριστής (μόνο από Προσωπικό)", () => {
  const d = canChangeRole(admin, partnerTarget, { role: "COMPANY_ADMIN" }, 1);
  assert.equal(d.ok, false);
  assert.equal(d.status, 400);
});

test("υποβιβασμός όταν υπάρχουν δύο διαχειριστές → επιτρέπεται", () => {
  assert.equal(canChangeRole(admin, admin2, { role: "STAFF" }, 1).ok, true);
});

/* ── Τελευταίος διαχειριστής ── */

test("ο τελευταίος διαχειριστής ΔΕΝ υποβιβάζεται", () => {
  const d = canChangeRole(admin, admin2, { role: "STAFF" }, 0);
  assert.equal(d.ok, false);
  assert.equal(d.status, 400);
});

test("ο τελευταίος διαχειριστής ΔΕΝ απενεργοποιείται / σβήνεται", () => {
  assert.equal(canChangeRole(admin, admin2, { isActive: false }, 0).ok, false);
  assert.equal(canDeactivate(admin, admin2, 0).ok, false);
  assert.equal(canDeactivate(admin, admin2, 1).ok, true);
});

test("κανείς δεν αλλάζει τον δικό του ρόλο ούτε σβήνει τον εαυτό του", () => {
  const self = { ...admin, isActive: true };
  assert.equal(canChangeRole(admin, self, { role: "STAFF" }, 5).status, 403);
  assert.equal(canDeactivate(admin, self, 5).status, 403);
});

/* ── Ξένη εταιρία ── */

test("ξένη εταιρία → 404 (ούτε προαγωγή ούτε απενεργοποίηση)", () => {
  assert.equal(canChangeRole(admin, foreignStaff, { role: "COMPANY_ADMIN" }, 1).status, 404);
  assert.equal(canDeactivate(admin, foreignStaff, 1).status, 404);
  assert.equal(canChangeRole(admin, null, { role: "STAFF" }, 1).status, 404);
});

/* ── STAFF / SUPER_ADMIN που προσπαθούν να δώσουν ρόλο ── */

test("STAFF (ακόμη και με users.*) δεν δίνει ρόλο Διαχειριστή", () => {
  assert.equal(canCreateWithRole(staffActor, "COMPANY_ADMIN").status, 403);
  assert.equal(canChangeRole(staffActor, staffTarget, { role: "COMPANY_ADMIN" }, 1).status, 403);
});

test("STAFF δεν υποβιβάζει ούτε απενεργοποιεί διαχειριστή", () => {
  assert.equal(canChangeRole(staffActor, admin2, { role: "STAFF" }, 3).status, 403);
  assert.equal(canDeactivate(staffActor, admin2, 3).status, 403);
});

test("SUPER_ADMIN δεν δίνει ρόλο Διαχειριστή από εδώ", () => {
  assert.equal(canCreateWithRole(superAdmin, "COMPANY_ADMIN").status, 403);
  assert.equal(canChangeRole(superAdmin, staffTarget, { role: "COMPANY_ADMIN" }, 1).status, 404);
});

test("άγνωστος ρόλος (π.χ. SUPER_ADMIN) απορρίπτεται", () => {
  assert.equal(canCreateWithRole(admin, "SUPER_ADMIN").ok, false);
  assert.equal(canChangeRole(admin, staffTarget, { role: "SUPER_ADMIN" }, 1).ok, false);
});

test("Προσωπικό ↔ Συνεργάτης: όπως πριν (δεν αφορά διαχειριστή)", () => {
  assert.equal(canChangeRole(admin, staffTarget, { role: "PARTNER" }, 0).ok, true);
  assert.equal(canCreateWithRole(staffActor, "STAFF").ok, true);
});
