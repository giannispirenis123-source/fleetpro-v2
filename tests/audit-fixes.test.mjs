// tests/audit-fixes.test.mjs
// Audit 10/2026 — οι διορθώσεις ασφάλειας/χρημάτων. Κάθε test αποτύγχανε
// πριν από τη διόρθωση (κανόνας που έλειπε ή route που ήταν ανοιχτό) και
// περνά μετά. Καθαρή λογική + στατικοί έλεγχοι — χωρίς βάση, χωρίς δίκτυο.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const V = await import("../src/lib/viewerCore.ts");
const L = await import("../src/lib/loginCore.ts");
const A = await import("../src/lib/adminRole.ts");
const B = await import("../src/lib/bookingStatusRule.ts");

/* ── Χρήστης σε κάθε αίτημα (όχι μόνο στο login) ── */

const row = (o = {}) => ({
  id: "u1",
  role: "STAFF",
  tenantId: "t1",
  isActive: true,
  permissions: {},
  tenant: { status: "ACTIVE" },
  ...o,
});
const sess = { userId: "u1", tenantId: "t1" };

test("viewer: ενεργός χρήστης ενεργής εταιρίας → δεκτός", () => {
  assert.ok(V.acceptViewerRow(row(), sess));
});

test("viewer: εταιρία SUSPENDED/CANCELLED → απορρίπτεται και με έγκυρο token", () => {
  assert.equal(V.acceptViewerRow(row({ tenant: { status: "SUSPENDED" } }), sess), null);
  assert.equal(V.acceptViewerRow(row({ tenant: { status: "CANCELLED" } }), sess), null);
  assert.ok(V.acceptViewerRow(row({ tenant: { status: "TRIAL" } }), sess));
});

test("viewer: ανενεργός / σβησμένος / άλλη εταιρία στο token → απορρίπτεται", () => {
  assert.equal(V.acceptViewerRow(row({ isActive: false }), sess), null);
  assert.equal(V.acceptViewerRow(null, sess), null);
  assert.equal(V.acceptViewerRow(row({ tenantId: "t2" }), sess), null);
  assert.equal(V.acceptViewerRow(row({ id: "u9" }), sess), null);
});

test("withAuth: διαβάζει τον χρήστη (loadViewer) σε κάθε αίτημα, ρόλος από τη βάση", () => {
  const api = read("src/lib/api.ts");
  assert.match(api, /loadViewer\(/);
  assert.match(api, /viewer\.role/);
  const locale = read("src/app/api/users/me/locale/route.ts");
  assert.match(locale, /loadViewer\(/, "η ανανέωση token από το locale ελέγχει τον χρήστη");
});

/* ── Σύνδεση ── */

test("login: λάθος κωδικός → ίδιο μήνυμα, ό,τι κι αν ισχύει για τον λογαριασμό", () => {
  const inactive = { isActive: false, tenant: { status: "ACTIVE" } };
  const suspended = { isActive: true, tenant: { status: "SUSPENDED" } };
  assert.equal(L.loginDecision(inactive, false).message, L.LOGIN_MSG.wrong);
  assert.equal(L.loginDecision(suspended, false).message, L.LOGIN_MSG.wrong);
  assert.equal(L.loginDecision(null, true).message, L.LOGIN_MSG.wrong);
});

test("login: ακυρωμένη εταιρία δεν συνδέεται (όχι μόνο η SUSPENDED)", () => {
  const r = L.loginDecision({ isActive: true, tenant: { status: "CANCELLED" } }, true);
  assert.equal(r.ok, false);
  assert.equal(r.message, L.LOGIN_MSG.suspended);
  assert.equal(L.loginDecision({ isActive: true, tenant: { status: "ACTIVE" } }, true).ok, true);
});

test("login: όριο προσπαθειών ανά email και ανά IP", () => {
  const src = read("src/app/api/auth/login/route.ts");
  assert.match(src, /LIMITS\.loginPerEmail/);
  assert.match(src, /LIMITS\.loginPerIp/);
  assert.match(src, /status:\s*429/);
});

/* ── Ανοιχτά endpoints / δημόσιο API ── */

test("το ανοιχτό /api/discounts/validate (tenantId από το body) δεν υπάρχει πια", () => {
  assert.equal(existsSync(new URL("../src/app/api/discounts/validate/route.ts", import.meta.url)), false);
});

test("δημόσια τιμή (quote): όριο ανά IP", () => {
  const src = read("src/app/api/public/quote/route.ts");
  assert.match(src, /LIMITS\.quotePerClient/);
  assert.match(src, /status:\s*429/);
});

/* ── Δικαιώματα μέσα στην εταιρία ── */

test("δικαιώματα: ο μη-Διαχειριστής δεν δίνει όσα δεν έχει ο ίδιος", () => {
  const staff = { role: "STAFF", permissions: { "bookings.view": true } };
  assert.deepEqual(A.permissionsBeyondActor(staff, { "bookings.view": true, "users.manage": true }), ["users.manage"]);
  assert.deepEqual(A.permissionsBeyondActor(staff, { "bookings.view": true }), []);
  // Ό,τι είχε ήδη ο χρήστης-στόχος μπορεί να μείνει.
  assert.deepEqual(A.permissionsBeyondActor(staff, { "users.manage": true }, { "users.manage": true }), []);
  assert.deepEqual(A.permissionsBeyondActor({ role: "COMPANY_ADMIN", permissions: {} }, { "users.manage": true }), []);
});

test("κωδικός άλλου χρήστη: μόνο ο Διαχειριστής", () => {
  assert.equal(A.canSetOthersPassword({ role: "STAFF", id: "u1" }, "u2"), false);
  assert.equal(A.canSetOthersPassword({ role: "STAFF", id: "u1" }, "u1"), true);
  assert.equal(A.canSetOthersPassword({ role: "COMPANY_ADMIN", id: "u1" }, "u2"), true);
  const create = read("src/app/api/company-users/route.ts");
  const edit = read("src/app/api/company-users/[id]/route.ts");
  assert.match(create, /permissionsBeyondActor\(/);
  assert.match(edit, /permissionsBeyondActor\(/);
  assert.match(edit, /canSetOthersPassword\(/);
});

test("κατάσταση κράτησης (PATCH): ο συνεργάτης δεν την αλλάζει, η ακύρωση θέλει bookings.cancel", () => {
  const all = { "bookings.status": true, "bookings.cancel": true };
  assert.equal(B.canChangeBookingStatus({ role: "PARTNER", permissions: all }, "CONFIRMED"), false);
  assert.equal(B.canChangeBookingStatus({ role: "STAFF", permissions: { "bookings.status": true } }, "CANCELLED"), false);
  assert.equal(B.canChangeBookingStatus({ role: "STAFF", permissions: { "bookings.status": true } }, "CONFIRMED"), true);
  assert.equal(B.canChangeBookingStatus({ role: "COMPANY_ADMIN", permissions: {} }, "CANCELLED"), true);
  assert.match(read("src/app/api/bookings/[id]/route.ts"), /canChangeBookingStatus\(/);
});

test("Πίνακας: έσοδα/τιμολόγια/ζημιές μόνο με το αντίστοιχο δικαίωμα", () => {
  const src = read("src/app/(dashboard)/dashboard/page.tsx");
  assert.match(src, /viewerCan\(viewer, "invoices\.view"\)/);
  assert.match(src, /viewerCan\(viewer, "damages\.view"\)/);
  assert.match(src, /seeInvoices\s*\?\s*db\.invoice\.aggregate/);
});

test("Service: οι κρατήσεις του dropdown με bookingScope (ο συνεργάτης μόνο τις δικές του)", () => {
  assert.match(read("src/app/(dashboard)/dashboard/service/page.tsx"), /where: bookingScope\(viewer\)/);
});

/* ── Κάρτα ── */

test("«Εμφάνιση» αριθμού κάρτας: όριο ανά χρήστη και καταγραφή στο ιστορικό", () => {
  const src = read("src/app/api/contracts/[id]/card-number/route.ts");
  assert.match(src, /LIMITS\.cardRevealPerUser/);
  assert.match(src, /contract\.card_reveal/);
  assert.match(src, /newData:\s*\{\s*kind/, "στο ιστορικό μόνο το είδος, όχι ο αριθμός");
});

/* ── Headers ── */

test("security headers: nosniff, HSTS, όχι iframe εκτός από το δημόσιο site", async () => {
  const cfg = (await import("../next.config.js")).default;
  const rules = await cfg.headers();
  const all = rules.find((r) => r.source === "/:path*");
  const names = all.headers.map((h) => h.key);
  assert.ok(names.includes("X-Content-Type-Options"));
  assert.ok(names.includes("Strict-Transport-Security"));
  const frames = rules.find((r) => r.headers.some((h) => h.key === "X-Frame-Options"));
  assert.ok(frames);
  assert.match(frames.source, /\(\?!s\/\)/, "το /s/* μένει embeddable");
});

/* ── Χρήματα ── */

const P = await import("../src/lib/public/payments.ts");

test("ληγμένη αναμονή πληρωμής: αποδεσμεύει ΜΟΝΟ κράτηση PENDING, όχι επιβεβαιωμένη", () => {
  const now = Date.UTC(2026, 9, 19, 12);
  const hold = { paymentStatus: "AWAITING_PAYMENT", paymentExpiresMs: now - 1 };
  assert.equal(P.holdExpired({ ...hold, status: "PENDING" }, now), true);
  assert.equal(P.holdExpired({ ...hold, status: "CONFIRMED" }, now), false);
  assert.equal(P.holdExpired({ ...hold, status: "ACTIVE" }, now), false);
  assert.equal(P.notExpiredHold(new Date(now)).NOT.status, "PENDING");
});

test("επιστροφή: υπολογισμός από την τρέχουσα γραμμή — δύο επιστροφές αθροίζονται, ποτέ πάνω από το ποσό", () => {
  const row = { status: "PAID", amountCents: 10_000, refundedCents: 0, retainedCents: 0 };
  const a = P.refundRowAfter(row, 3_000);
  const b = P.refundRowAfter({ ...row, ...a }, 4_000);
  assert.equal(b.refundedCents, 7_000);
  assert.equal(b.status, "PARTIALLY_REFUNDED");
  const over = P.refundRowAfter({ ...row, ...b }, 9_000);
  assert.equal(over.refundedCents, 10_000);
  assert.equal(over.status, "REFUNDED");
  // Με κρατημένο υπόλοιπο: refunded + retained <= amount.
  const r = P.refundRowAfter({ ...row, retainedCents: 6_000 }, 5_000);
  assert.ok(r.refundedCents + r.retainedCents <= 10_000);
  const src = read("src/lib/public/paymentServer.ts");
  assert.match(src, /FOR UPDATE[\s\S]*refundRowAfter\(fresh/);
});

test("«κρατείται»: γράφει μόνο αν η πληρωμή δεν άλλαξε στο μεταξύ", () => {
  const w = P.retainWhere({ id: "p1", tenantId: "t1", bookingId: "b1", refundedCents: 2_000, retainedCents: 0 });
  assert.equal(w.tenantId, "t1");
  assert.equal(w.refundedCents, 2_000);
  assert.equal(w.retainedCents, 0);
  assert.match(read("src/app/api/bookings/[id]/retain/route.ts"), /status:\s*409/);
});

test("αριθμός κράτησης: αριθμητικό max (μετά το 999 έρχεται 1000, όχι ξανά 1000)", () => {
  const C = read("src/lib/bookingCreate.ts");
  assert.doesNotMatch(C, /orderBy:\s*\{\s*bookingNumber:\s*"desc"/);
  assert.match(C, /MAX\(CAST\(substring\("bookingNumber"/);
  assert.match(C, /export function bookingNumberAfter/);
});

test("κρατήσεις dashboard/walk-in/αλλαγή: κλείδωμα εταιρίας και επανέλεγχος σύγκρουσης μέσα σε αυτό", () => {
  const C = read("src/lib/bookingCreate.ts");
  assert.match(C, /pg_advisory_xact_lock\(hashtext\(\$\{lockKeyFor\(plan\.tenantId\)\}\)\)[\s\S]*checkVehicleConflicts\(\{\s*client: tx/);
  const patch = read("src/app/api/bookings/[id]/route.ts");
  assert.match(patch, /pg_advisory_xact_lock[\s\S]*checkVehicleConflicts\(\{ \.\.\.recheck, client: tx \}\)/);
  for (const f of ["src/app/api/bookings/route.ts", "src/app/api/contracts/walk-in/route.ts", "src/app/api/bookings/[id]/route.ts"]) {
    assert.match(read(f), /instanceof BookingConflictError\) return conflict/, f);
  }
});

test("Stripe checkout: σύντομο όριο χρόνου μέσα στο αίτημα του πελάτη", () => {
  assert.match(read("src/lib/public/paymentServer.ts"), /fleetpro-checkout-\$\{b\.id\}`, timeout: 8_000, maxNetworkRetries: 1/);
});
