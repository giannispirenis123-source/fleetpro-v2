// tests/billing-test-clocks.test.mjs
// Test clocks (ΜΟΝΟ Preview + sk_test_ + flag) και ένδειξη «πλήρης χρέωση
// ιδρυτή χωρίς έκπτωση». Χωρίς βάση, χωρίς δίκτυο.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const B = await import("../src/lib/billing/core.ts");
const { handleBillingEvent } = await import("../src/lib/billing/webhook.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const DAY = 86_400_000;

const ON = { STRIPE_BILLING_TEST_CLOCKS: "1", STRIPE_SECRET_KEY: "sk_test_x", VERCEL_ENV: "preview" };

test("test clocks ΜΟΝΟ με flag + sk_test_ + VERCEL_ENV=preview — αλλιώς αγνοούνται εντελώς", () => {
  assert.equal(B.testClocksEnabled(ON), true);
  assert.equal(B.testClocksEnabled({ ...ON, STRIPE_BILLING_TEST_CLOCKS: "true" }), true);
  assert.equal(B.testClocksEnabled({ ...ON, STRIPE_SECRET_KEY: "sk_live_x" }), false, "live κλειδί");
  assert.equal(B.testClocksEnabled({ ...ON, STRIPE_SECRET_KEY: "rk_test_x" }), false);
  assert.equal(B.testClocksEnabled({ ...ON, VERCEL_ENV: "production" }), false, "Production");
  assert.equal(B.testClocksEnabled({ ...ON, VERCEL_ENV: undefined }), false, "τοπικά");
  assert.equal(B.testClocksEnabled({ ...ON, VERCEL_ENV: "development" }), false);
  assert.equal(B.testClocksEnabled({ ...ON, STRIPE_BILLING_TEST_CLOCKS: "" }), false, "flag κλειστό");
  assert.equal(B.testClocksEnabled({ ...ON, STRIPE_BILLING_TEST_CLOCKS: "0" }), false);
  assert.equal(B.testClocksEnabled({}), false);
});

test("η ώρα της εταιρίας: του clock μόνο όταν είναι ενεργά ΚΑΙ η εταιρία έχει clock", () => {
  const real = new Date("2026-11-01T10:00:00Z");
  const clockAt = new Date("2027-01-15T10:00:00Z");
  const t = { stripeTestClockId: "clock_1", billingClockAt: clockAt };
  assert.equal(B.billingNow(t, real, true).getTime(), clockAt.getTime());
  assert.equal(B.billingNow(t, real, false).getTime(), real.getTime(), "clocks κλειστά → πραγματική ώρα");
  assert.equal(B.billingNow({ stripeTestClockId: null, billingClockAt: clockAt }, real, true).getTime(), real.getTime());
  assert.equal(B.billingNow({ stripeTestClockId: "clock_1", billingClockAt: null }, real, true).getTime(), real.getTime());
  // Χάρη 7 ημερών μετρά με την ώρα του clock.
  const s = { billingStatus: "past_due", trialEndsAt: null, pastDueSince: new Date(clockAt.getTime() - 8 * DAY) };
  assert.equal(B.billingAccess(s, B.billingNow(t, real, true)).mode, "read_only");
  assert.equal(B.billingAccess(s, B.billingNow(t, real, false)).mode, "full");
});

/** Κάθε κλήση test clock στον κώδικα περνά από τον έλεγχο clocksOn(). */
test("καμία κλήση test clock χωρίς τον έλεγχο (live κλειδί / Production / flag κλειστό → καμία κλήση)", () => {
  const files = [];
  const walk = (d) =>
    readdirSync(d).forEach((n) => {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) files.push(p);
    });
  walk(new URL("../src", import.meta.url).pathname);
  const users = files.filter((f) => /testHelpers\.testClocks|test_clock:/.test(readFileSync(f, "utf8")));
  assert.deepEqual(users.map((f) => f.replace(/.*\/src\//, "src/")), ["src/lib/billing/billingServer.ts"]);
  const s = read("src/lib/billing/billingServer.ts");
  assert.match(s, /export const clocksOn = \(\): boolean => testClocksEnabled\(process\.env\);/);
  // Δημιουργία clock: μόνο μέσα σε if (clocksOn())
  const create = s.indexOf("testHelpers.testClocks.create(");
  assert.ok(create > 0 && s.lastIndexOf("if (clocksOn()) {", create) > s.lastIndexOf("async function ensureCustomer", create));
  // test_clock στον πελάτη: μόνο αν φτιάχτηκε clock
  assert.match(s, /\.\.\.\(clock \? \{ test_clock: clock\.id \} : \{\}\)/);
  // Ανάγνωση clock: μόνο με clocksOn() && t.stripeTestClockId
  const retrieve = s.indexOf("testHelpers.testClocks.retrieve(");
  assert.ok(s.lastIndexOf("if (clocksOn() && t.stripeTestClockId) {", retrieve) > 0);
  // Χωρίς clock: ΙΔΙΟ idempotency key με πριν (καμία αλλαγή συμπεριφοράς).
  assert.match(s, /clock \? `billing-customer-clock-\$\{t\.id\}` : `billing-customer-\$\{t\.id\}`/);
});

test("τα σημεία που μετρούν χρόνο συνδρομής χρησιμοποιούν την ώρα της εταιρίας", () => {
  for (const f of [
    "src/lib/viewer.ts",
    "src/lib/billing/access.ts",
    "src/app/(dashboard)/dashboard/layout.tsx",
    "src/lib/billing/foundingAdmin.ts",
    "src/lib/billing/billingServer.ts",
    "src/lib/billing/webhook.ts",
  ]) {
    assert.match(read(f), /billingNow\(/, f);
  }
});

/* ── webhook ── */

const CONFIG = B.readBillingConfig({
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_BILLING_WEBHOOK_SECRET: "whsec_x",
  STRIPE_BILLING_PRICE_STARTER_MONTHLY: "price_sm",
  STRIPE_BILLING_PRICE_STARTER_YEARLY: "price_sy",
  STRIPE_BILLING_PRICE_PRO_MONTHLY: "price_pm",
  STRIPE_BILLING_PRICE_PRO_YEARLY: "price_py",
  STRIPE_BILLING_PRICE_BUSINESS_MONTHLY: "price_bm",
  STRIPE_BILLING_PRICE_BUSINESS_YEARLY: "price_by",
});

function deps({ clocksOn = false, isFounder = true, rows = [], tenant = {} } = {}) {
  const d = {
    config: CONFIG,
    clocksOn,
    seen: new Set(),
    fullCharges: [],
    clockUpdates: [],
    patches: [],
    rows,
    invoices: {},
    tenant: {
      id: "t1", stripeCustomerId: "cus_1", isFounder, status: "ACTIVE", planKey: "starter", billingInterval: "month",
      stripeSubId: "sub_1", billingStatus: "trialing", trialEndsAt: null, pastDueSince: null,
      stripeTestClockId: null, billingClockAt: null, ...tenant,
    },
    now: () => new Date("2026-11-01T10:00:00Z"),
    eventSeen: async (id) => d.seen.has(id),
    markEvent: async (id) => void d.seen.add(id),
    tenantByCustomer: async (c) => (c === "cus_1" ? d.tenant : null),
    retrieveSubscription: async () => ({ id: "sub_1", status: "past_due", priceId: "price_sm", trialEnd: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, customerId: "cus_1", tenantIdMeta: "t1" }),
    retrieveInvoice: async (id) => ({ customerId: "cus_1", founderCoupon: false, ...d.invoices[id] }),
    applyPatch: async (_t, p) => void d.patches.push(p),
    founderInvoices: async () => d.rows,
    applyFounderDiscount: async () => {},
    recordFounderInvoice: async (r) => void d.rows.push({ ...r }),
    setFounderInvoiceStatus: async () => {},
    setFounderDiscountEnd: async () => {},
    recordFullCharge: async (r) => void d.fullCharges.push(r),
    setClockTime: async (id, at) => (d.clockUpdates.push([id, at]), 1),
  };
  return d;
}
const inv = (x = {}) => ({ id: "in_full", status: "paid", billingReason: "subscription_update", subscriptionId: "sub_1", amountDue: 3900, amountPaid: 3900, priceId: "price_sm", periodEnd: null, hasDiscount: false, ...x });
const ev = (type, object, extra = {}) => ({ id: `evt_${Math.random()}`, type, data: { object }, ...extra });

test("ιδρυτής πλήρωσε 39 € χωρίς έκπτωση (λήξη δοκιμής «τώρα») → ένδειξη + log, ΚΑΜΙΑ επιστροφή", async () => {
  const d = deps();
  d.invoices.in_full = inv();
  const warn = console.warn;
  const logs = [];
  console.warn = (m) => logs.push(String(m));
  try {
    assert.equal(await handleBillingEvent(ev("invoice.paid", { id: "in_full", customer: "cus_1" }), d), "full_charge");
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(d.fullCharges, [{ tenantId: "t1", stripeInvoiceId: "in_full", amountCents: 3900, billingReason: "subscription_update" }]);
  assert.deepEqual(logs, ["[FleetPro] Billing: ιδρυτής χρεώθηκε ΧΩΡΙΣ έκπτωση tenant=t1 invoice=in_full"]);
  // Η κατάσταση της συνδρομής συγχρονίζεται κανονικά.
  assert.equal(d.patches.length, 1);
});

test("ΟΧΙ ένδειξη: με έκπτωση, μέσω Checkout με coupon, μη ιδρυτής, 0 €, ή εξαντλημένοι 12 μήνες", async () => {
  const cases = [
    [deps(), inv({ hasDiscount: true })],
    [deps(), { ...inv(), founderCoupon: true }],
    [deps({ isFounder: false }), inv()],
    [deps(), inv({ amountDue: 0, amountPaid: 0 })],
    [deps({ rows: Array.from({ length: 12 }, (_, i) => ({ stripeInvoiceId: `in_${i}`, months: 1, status: "paid", periodEnd: null })) }), inv()],
  ];
  for (const [d, i] of cases) {
    d.invoices.in_full = i;
    await handleBillingEvent(ev("invoice.paid", { id: "in_full", customer: "cus_1" }), d);
    assert.equal(d.fullCharges.length, 0, JSON.stringify(i));
  }
  // Τιμολόγιο που πήρε έκπτωση από εμάς (υπάρχει γραμμή) → όχι ένδειξη.
  const d = deps({ rows: [{ stripeInvoiceId: "in_full", months: 1, status: "open", periodEnd: null }] });
  d.invoices.in_full = inv({ billingReason: "subscription_cycle", hasDiscount: true, amountPaid: 1950 });
  await handleBillingEvent(ev("invoice.paid", { id: "in_full", customer: "cus_1" }), d);
  assert.equal(d.fullCharges.length, 0);
});

test("test_clock.ready: ενημερώνει την ώρα ΜΟΝΟ με ενεργά clocks· αλλιώς αγνοείται", async () => {
  const frozen = Math.floor(new Date("2026-12-01T10:00:00Z").getTime() / 1000);
  const off = deps({ clocksOn: false });
  assert.equal(await handleBillingEvent(ev("test_helpers.test_clock.ready", { id: "clock_1", frozen_time: frozen }), off), "ignored_type");
  assert.equal(off.clockUpdates.length, 0);
  const on = deps({ clocksOn: true });
  assert.equal(await handleBillingEvent(ev("test_helpers.test_clock.ready", { id: "clock_1", frozen_time: frozen }), on), "applied");
  assert.equal(on.clockUpdates[0][1].getTime(), frozen * 1000);
});

test("με clock: pastDueSince γράφεται με την ώρα του clock (όχι την πραγματική)", async () => {
  const clockAt = new Date("2027-02-10T09:00:00Z");
  const d = deps({ clocksOn: true, isFounder: false, tenant: { billingStatus: "active", stripeTestClockId: "clock_1", billingClockAt: clockAt } });
  d.invoices.in_f = inv({ id: "in_f", status: "open" });
  await handleBillingEvent(ev("invoice.payment_failed", { id: "in_f", customer: "cus_1" }), d);
  assert.equal(d.patches[0].pastDueSince.getTime(), clockAt.getTime());
  // Clocks κλειστά (π.χ. Production): πραγματική ώρα, ακόμα κι αν έμεινε clock id στη βάση.
  const p = deps({ clocksOn: false, isFounder: false, tenant: { billingStatus: "active", stripeTestClockId: "clock_1", billingClockAt: clockAt } });
  p.invoices.in_f = inv({ id: "in_f", status: "open" });
  await handleBillingEvent(ev("invoice.payment_failed", { id: "in_f", customer: "cus_1" }), p);
  assert.equal(p.patches[0].pastDueSince.getTime(), new Date("2026-11-01T10:00:00Z").getTime());
});

test("SQL 37: μόνο προσθετικό (nullable στήλες + νέος πίνακας), καμία διαγραφή", () => {
  const sql = read("prisma/sql/37-billing-test-clocks.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "stripeTestClockId" TEXT;/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "billingClockAt" TIMESTAMP\(3\);/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "founder_full_charges"/);
  assert.doesNotMatch(sql, /DROP|DELETE FROM|NOT NULL DEFAULT[^,]*"stripeTestClockId"/);
});

test("Super Admin: ένδειξη «Test clock» και «Πλήρης χρέωση χωρίς έκπτωση», χωρίς κουμπιά χρόνου", () => {
  const sa = read("src/app/(super-admin)/super-admin/page.tsx");
  assert.match(sa, /data-testid="test-clock-badge">Test clock</);
  assert.match(sa, /Πλήρης χρέωση χωρίς έκπτωση: \{/);
  assert.doesNotMatch(sa, /testClocks|advance/i);
  assert.match(read("src/app/api/tenants/route.ts"), /founderFullCharges: \{ select: \{ stripeInvoiceId: true, amountCents: true \}/);
});
