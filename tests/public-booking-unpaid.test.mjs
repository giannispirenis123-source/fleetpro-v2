// tests/public-booking-unpaid.test.mjs — νέα δημόσια κράτηση ανάλογα με τη
// συνδρομή: «Απλήρωτη» → δεκτή ως PENDING, μόνο πληρωμή στην παραλαβή·
// ακυρωμένη / ληγμένη δοκιμή / αναμονή κάρτας → 409· οι άλλες αμετάβλητες.

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

const B = await import("../src/lib/billing/core.ts");
const { availableMethods, resolvePaymentMethod } = await import("../src/lib/public/payments.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const DAY = 86_400_000;
const T0 = new Date("2026-10-28T09:00:00.000Z");
const at = (d) => new Date(T0.getTime() + d * DAY);
const st = (billingStatus, extra = {}) => ({ billingStatus, trialEndsAt: null, pastDueSince: null, ...extra });

/** Οι τρόποι πληρωμής που βλέπει ο επισκέπτης για μια εταιρία με online πληρωμές. */
const methodsFor = (t, now, options = "ONLINE_OR_PICKUP") => availableMethods(B.sitePaymentOptionsFor(options, B.publicBookingPolicy(t, now)));

test("απλήρωτη (past_due/unpaid, μέσα στη χάρη ή μετά) → δεκτή, μόνο πληρωμή στην παραλαβή", () => {
  for (const s of ["past_due", "unpaid"]) {
    for (const [label, t] of [
      ["μέσα στη χάρη", st(s, { pastDueSince: at(-2) })],
      ["μετά τη χάρη (μόνο ανάγνωση)", st(s, { pastDueSince: at(-10) })],
    ]) {
      assert.equal(B.publicBookingPolicy(t, T0), "pickup_only", `${s} ${label}`);
      for (const options of ["ONLINE_OR_PICKUP", "ONLINE_ONLY", "PICKUP_ONLY"]) {
        assert.deepEqual(methodsFor(t, T0, options), ["PICKUP"], `${s} ${label} ${options}`);
        // Ό,τι κι αν ζητήσει ο client (ONLINE), η υποβολή γίνεται με PICKUP → κανένα Stripe session.
        assert.deepEqual(resolvePaymentMethod("ONLINE", B.sitePaymentOptionsFor(options, "pickup_only")), { ok: true, method: "PICKUP" });
      }
    }
  }
  // Η απλήρωτη μετά τη χάρη ΕΙΝΑΙ σε μόνο ανάγνωση για το dashboard — αυτό δεν αλλάζει.
  assert.equal(B.billingAccess(st("unpaid", { pastDueSince: at(-10) }), T0).mode, "read_only");
});

test("ακυρωμένη / ληγμένη δοκιμή / αναμονή κάρτας → closed (409 όπως πριν)", () => {
  const cases = [
    st("canceled"),
    st("incomplete_expired"),
    st("paused"),
    st("founder_trial", { trialEndsAt: at(-1) }),
    st("awaiting_checkout"),
    st("incomplete"),
  ];
  for (const t of cases) assert.equal(B.publicBookingPolicy(t, T0), "closed", JSON.stringify(t));
});

test("ενεργή / δοκιμή / εκτός χρέωσης → αμετάβλητη (online όπως ρύθμισε η εταιρία)", () => {
  const cases = [
    st("active"),
    st("exempt"),
    st("trialing", { trialEndsAt: at(5) }),
    st("founder_trial", { trialEndsAt: at(5) }),
    st("founder_trial"), // το ρολόι δεν ξεκίνησε
    st("unknown_value"),
  ];
  for (const t of cases) {
    assert.equal(B.publicBookingPolicy(t, T0), "open", JSON.stringify(t));
    for (const o of ["ONLINE_OR_PICKUP", "ONLINE_ONLY", "PICKUP_ONLY"]) assert.equal(B.sitePaymentOptionsFor(o, "open"), o);
  }
  assert.deepEqual(methodsFor(st("active"), T0), ["ONLINE", "PICKUP"]);
});

test("ώρα του test clock: ίδια απόφαση με το billingAccess (μία πηγή)", () => {
  // Δοκιμή ιδρυτή που λήγει σε 5 ημέρες: με clock +6 ημέρες → closed· με πραγματική ώρα → open.
  const t = { ...st("founder_trial", { trialEndsAt: at(5) }), stripeTestClockId: "clock_1", billingClockAt: at(6) };
  assert.equal(B.publicBookingPolicy(t, B.billingNow(t, T0, true)), "closed");
  assert.equal(B.publicBookingPolicy(t, B.billingNow(t, T0, false)), "open");
  // Για κάθε κατάσταση εκτός της απλήρωτης: closed ⇔ billingAccess = read_only.
  for (const s of ["active", "exempt", "trialing", "founder_trial", "awaiting_checkout", "canceled", "incomplete", "paused"]) {
    const x = st(s, { trialEndsAt: at(-1) });
    assert.equal(B.publicBookingPolicy(x, T0) === "closed", B.billingAccess(x, T0).mode === "read_only", s);
  }
  const access = read("src/lib/billing/access.ts");
  assert.match(access, /publicBookingPolicy\(t, billingNow\(t, now, testClocksEnabled\(process\.env\)\)\)/);
  assert.doesNotMatch(access, /tenantReadOnly/);
});

test("υποβολή: closed → 409 με το ίδιο μήνυμα, πριν από κατάλογο/όρια· απλήρωτη → μόνο PICKUP", () => {
  const s = read("src/lib/public/bookingSubmit.ts");
  const policyAt = s.indexOf("tenantPublicBookingPolicy(resolved.companyId, now)");
  assert.ok(policyAt > 0 && policyAt < s.indexOf("loadSiteCatalog("), "η απόφαση πριν από τον κατάλογο");
  assert.match(s, /if \(policy === "closed"\) \{\s*return \{\s*ok: false,\s*status: 409,/);
  assert.match(s, /Οι online κρατήσεις δεν είναι διαθέσιμες αυτή τη στιγμή\. Επικοινωνήστε απευθείας με την εταιρία\./);
  assert.match(s, /Online bookings are not available right now\. Please contact the company directly\./);
  // Τρόπος πληρωμής ΜΟΝΟ μέσω της απόφασης· online (Stripe) μόνο αν ο τρόπος βγήκε ONLINE.
  assert.match(s, /resolvePaymentMethod\(input\.paymentMethod, sitePaymentOptionsFor\(pay\?\.options \?\? "PICKUP_ONLY", policy\)\)/);
  assert.match(s, /const online = method\.method === "ONLINE" && !!origin;/);
  assert.match(s, /if \(!online\) return \{ ok: true, code: result\.code, url: bookingUrl \};/);
  // Ίδια όρια, ίδιο κλείδωμα, ίδια ροή εγγραφής (PENDING όπως κάθε κράτηση από το site).
  for (const re of [/LIMITS\.bookingPerClient/, /LIMITS\.bookingPerEmail/, /LIMITS\.bookingPerTenant/, /pg_advisory_xact_lock/, /withBookingNumberRetry\(\(\) => runSiteBooking\(/]) assert.match(s, re);
  assert.match(read("src/lib/public/bookingWrite.ts"), /status: SITE_BOOKING_STATUS,/);
  assert.match(read("src/lib/public/bookingRequest.ts"), /export const SITE_BOOKING_STATUS = "PENDING" as const;/);
});

test("φόρμα του site: οι τρόποι πληρωμής από την ΙΔΙΑ απόφαση με την υποβολή", () => {
  const r = read("src/lib/storefront/routes.tsx");
  assert.match(r, /methods: availableMethods\(sitePaymentOptionsFor\(pay\?\.options \?\? "PICKUP_ONLY", policy\)\)/);
  assert.match(r, /tenantPublicBookingPolicy\(companyId\)/);
});

test("το dashboard σε μόνο ανάγνωση ΔΕΝ άλλαξε", () => {
  const api = read("src/lib/api.ts");
  assert.match(api, /viewer\.readOnly && !readOnlyAllows\(req\.method, req\.nextUrl\.pathname\)/);
  // Ό,τι επιτρέπεται σήμερα στις υπάρχουσες κρατήσεις.
  assert.equal(B.readOnlyAllows("POST", "/api/bookings/b1/decision"), true);
  assert.equal(B.readOnlyAllows("PATCH", "/api/bookings/b1"), true);
  assert.equal(B.readOnlyAllows("DELETE", "/api/bookings/b1"), false);
  assert.equal(B.readOnlyAllows("POST", "/api/bookings"), false);
  assert.equal(B.readOnlyAllows("POST", "/api/bookings/b1/email"), false);
});
