// tests/billing-founding.test.mjs
// Συνδρομές εταιριών (Stripe Billing, SQL 36) + πρόγραμμα «Πρώτες 10 εταιρίες».
// Όρια πλάνων, λήξη δοκιμής, απλήρωτη → μόνο ανάγνωση, τι επιτρέπεται σε
// «μόνο ανάγνωση», συγχρονισμός συνδρομής, έκπτωση ιδρυτή για 12 ΠΛΗΡΩΜΕΝΟΥΣ
// μήνες (και με δοκιμή), webhook με ψεύτικες εξαρτήσεις, δημόσιο endpoint
// θέσεων χωρίς διαρροή, κείμενα. Χωρίς βάση, χωρίς δίκτυο.
// Οι ταυτόχρονες διεκδικήσεις με ΠΡΑΓΜΑΤΙΚΗ PostgreSQL:
// tests/e2e/founding-concurrency.db.ts (δες την κεφαλίδα του).

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
const F = await import("../src/lib/billing/founding.ts");
const { handleBillingEvent } = await import("../src/lib/billing/webhook.ts");
const { resolveEntitlements, checkLimit } = await import("../src/lib/entitlementsCore.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const DAY = 86_400_000;
const T0 = new Date("2026-11-01T10:00:00Z");
const at = (days) => new Date(T0.getTime() + days * DAY);

// Ίδιες τιμές με το prisma/sql/36-billing-founding.sql.
const PLANS = {
  starter: { key: "starter", name: "Starter", modules: { dashboard: true, publicSite: true, multiStore: false }, limits: { maxUsers: null, maxVehicles: 15 } },
  pro: { key: "pro", name: "Pro", modules: { dashboard: true, publicSite: true, multiStore: false }, limits: { maxUsers: null, maxVehicles: 50 } },
  business: { key: "business", name: "Business", modules: { dashboard: true, publicSite: true, multiStore: true }, limits: { maxUsers: null, maxVehicles: null } },
};

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_BILLING_WEBHOOK_SECRET: "whsec_x",
  STRIPE_BILLING_PRICE_STARTER_MONTHLY: "price_sm",
  STRIPE_BILLING_PRICE_STARTER_YEARLY: "price_sy",
  STRIPE_BILLING_PRICE_PRO_MONTHLY: "price_pm",
  STRIPE_BILLING_PRICE_PRO_YEARLY: "price_py",
  STRIPE_BILLING_PRICE_BUSINESS_MONTHLY: "price_bm",
  STRIPE_BILLING_PRICE_BUSINESS_YEARLY: "price_by",
};
const CONFIG = B.readBillingConfig(ENV);

/* ── Όρια πλάνων ── */

test("όρια πλάνων από τη βάση: Starter 15, Pro 50, Business απεριόριστα", () => {
  const s = resolveEntitlements(PLANS.starter, {});
  assert.equal(s.limits.vehicles, 15);
  assert.equal(checkLimit(s, "vehicles", 14).ok, true);
  const full = checkLimit(s, "vehicles", 15);
  assert.equal(full.ok, false);
  assert.match(full.message, /έως 15 οχήματα/);
  assert.equal(checkLimit(resolveEntitlements(PLANS.pro, {}), "vehicles", 49).ok, true);
  assert.equal(checkLimit(resolveEntitlements(PLANS.pro, {}), "vehicles", 50).ok, false);
  assert.equal(checkLimit(resolveEntitlements(PLANS.business, {}), "vehicles", 10_000).ok, true);
  // Χρήστες: απεριόριστοι σε όλα
  for (const p of Object.values(PLANS)) assert.equal(resolveEntitlements(p, {}).limits.users, null);
});

test("override εταιρίας υπερισχύει του ορίου του πλάνου (αλλαγή χωρίς κώδικα)", () => {
  const e = resolveEntitlements(PLANS.starter, { limits: { maxVehicles: 20 } });
  assert.equal(checkLimit(e, "vehicles", 19).ok, true);
});

test("SQL 36: τιμές χωρίς ΦΠΑ, ετήσια = 10 μήνες, όρια στη βάση, υπάρχουσες εταιρίες exempt", () => {
  const sql = read("prisma/sql/36-billing-founding.sql");
  assert.match(sql, /'starter',\s+'Starter',[\s\S]*?"maxVehicles":15}',\s+3900,\s+39000/);
  assert.match(sql, /'pro',\s+'Pro',[\s\S]*?"maxVehicles":50}',\s+7900,\s+79000/);
  assert.match(sql, /'business',\s+'Business',[\s\S]*?"maxVehicles":null}', 14900, 149000/);
  assert.match(sql, /"billingStatus" TEXT NOT NULL DEFAULT 'exempt'/);
  assert.match(sql, /CHECK \("maxSlots" = 10\)/);
  assert.match(sql, /CHECK \("slotNumber" BETWEEN 1 AND 10\)/);
  assert.match(sql, /founder_claims_slotNumber_key/);
  assert.match(sql, /ON CONFLICT \("key"\) DO NOTHING/);
  assert.doesNotMatch(sql, /DELETE FROM|DROP TABLE|DROP COLUMN/);
});

test("τιμή ιδρυτή 50%: 19,50 / 39,50 / 74,50 €", () => {
  assert.equal(B.founderPriceCents(3900), 1950);
  assert.equal(B.founderPriceCents(7900), 3950);
  assert.equal(B.founderPriceCents(14900), 7450);
  assert.equal(B.formatEuro(1950, "el").replace(/\s/g, " "), "19,50 €");
});

/* ── Μόνο ανάγνωση ── */

const st = (billingStatus, extra = {}) => ({ billingStatus, trialEndsAt: null, pastDueSince: null, ...extra });

test("υπάρχουσες εταιρίες (exempt) και ενεργή συνδρομή: πλήρης πρόσβαση", () => {
  assert.equal(B.billingAccess(st("exempt"), at(999)).mode, "full");
  assert.equal(B.billingAccess(st("active"), at(999)).mode, "full");
  assert.equal(B.billingAccess(st("κάτι-άγνωστο"), at(0)).mode, "full");
});

test("δοκιμή ιδρυτή: το ρολόι δεν μετρά πριν το πρώτο όχημα· 30 ημέρες από εκεί· μετά μόνο ανάγνωση", () => {
  assert.equal(B.billingAccess(st("founder_trial"), at(400)).mode, "full");
  const end = B.founderTrialEnd(at(5));
  assert.equal(end.getTime(), at(35).getTime());
  assert.deepEqual(B.billingAccess(st("founder_trial", { trialEndsAt: end }), at(34)).mode, "full");
  assert.equal(B.billingAccess(st("founder_trial", { trialEndsAt: end }), at(34)).warning, "trial");
  assert.deepEqual(B.billingAccess(st("founder_trial", { trialEndsAt: end }), at(35)), { mode: "read_only", reason: "trial_ended" });
});

test("χωρίς κωδικό: πριν το Checkout μόνο ανάγνωση· στη δοκιμή του Stripe πλήρης", () => {
  assert.deepEqual(B.billingAccess(st("awaiting_checkout"), at(0)), { mode: "read_only", reason: "checkout_required" });
  assert.equal(B.billingAccess(st("trialing", { trialEndsAt: at(14) }), at(3)).mode, "full");
});

test("απλήρωτη: 7 ημέρες χάρη (το Stripe ξαναδοκιμάζει), μετά μόνο ανάγνωση", () => {
  const s = st("past_due", { pastDueSince: at(0) });
  const d6 = B.billingAccess(s, at(6.9));
  assert.equal(d6.mode, "full");
  assert.equal(d6.warning, "past_due");
  assert.equal(d6.until.getTime(), at(7).getTime());
  assert.deepEqual(B.billingAccess(s, at(7)), { mode: "read_only", reason: "unpaid" });
  assert.deepEqual(B.billingAccess(st("unpaid", { pastDueSince: at(0) }), at(8)), { mode: "read_only", reason: "unpaid" });
  assert.deepEqual(B.billingAccess(st("canceled"), at(0)), { mode: "read_only", reason: "canceled" });
});

test("μόνο ανάγνωση: ΚΑΜΙΑ νέα κράτηση/όχημα/ρύθμιση· υπάρχουσες κρατήσεις και συμβόλαια συνεχίζουν", () => {
  const no = [
    ["POST", "/api/bookings"],
    ["POST", "/api/vehicles"],
    ["PATCH", "/api/vehicles/v1"],
    ["POST", "/api/customers"],
    ["POST", "/api/company-users"],
    ["PATCH", "/api/settings"],
    ["POST", "/api/contracts/walk-in"],
    ["POST", "/api/contracts/walk-in/customers"],
    ["DELETE", "/api/bookings/b1"],
    ["DELETE", "/api/vehicles/v1"],
    ["PATCH", "/api/storefront"],
    ["POST", "/api/public-site/rates"],
  ];
  for (const [m, p] of no) assert.equal(B.readOnlyAllows(m, p), false, `${m} ${p}`);
  const yes = [
    ["GET", "/api/vehicles"],
    ["GET", "/api/bookings"],
    ["POST", "/api/billing/checkout"],
    ["POST", "/api/billing/portal"],
    ["POST", "/api/feedback"],
    ["PATCH", "/api/users/me/locale"],
    ["POST", "/api/auth/logout"],
    ["PATCH", "/api/bookings/b1"],
    ["POST", "/api/bookings/b1/decision"],
    ["POST", "/api/bookings/preview"],
    ["POST", "/api/contracts"],
    ["PATCH", "/api/contracts/c1"],
    ["POST", "/api/contracts/c1/sign"],
    ["POST", "/api/contracts/c1/photos"],
    ["DELETE", "/api/contracts/c1/photos/p1"],
  ];
  for (const [m, p] of yes) assert.equal(B.readOnlyAllows(m, p), true, `${m} ${p}`);
});

test("μόνο ανάγνωση στον server: φύλακας withAuth + δημόσια κράτηση· η σελίδα /s/ μένει", () => {
  const api = read("src/lib/api.ts");
  assert.match(api, /viewer\.readOnly && !readOnlyAllows\(req\.method, req\.nextUrl\.pathname\)/);
  assert.match(api, /code: "read_only"/);
  assert.match(read("src/lib/viewer.ts"), /billingAccess\(row\.tenant, billingNow\(row\.tenant, new Date\(\), testClocksEnabled\(process\.env\)\)\)\.mode === "read_only"/);
  const submit = read("src/lib/public/bookingSubmit.ts");
  assert.ok(submit.indexOf("tenantReadOnly(") > 0 && submit.indexOf("tenantReadOnly(") < submit.indexOf("loadSiteCatalog("));
  // Καμία διαγραφή δεδομένων στη ροή συνδρομής.
  for (const f of ["src/lib/billing/core.ts", "src/lib/billing/billingServer.ts", "src/lib/billing/webhook.ts"]) {
    assert.doesNotMatch(read(f), /\.delete(Many)?\(/, f);
  }
});

/* ── Env: ΜΟΝΟ test mode ── */

test("Billing μόνο με test κλειδί και όλα τα price ids· live κλειδί → κλειστό", () => {
  assert.equal(CONFIG.ready, true);
  assert.deepEqual(CONFIG.prices.price_py, { plan: "pro", interval: "year" });
  const live = B.readBillingConfig({ ...ENV, STRIPE_SECRET_KEY: "sk_live_x" });
  assert.equal(live.ready, false);
  assert.ok(live.problems.some((p) => p.startsWith("STRIPE_SECRET_KEY")));
  const missing = B.readBillingConfig({ ...ENV, STRIPE_BILLING_WEBHOOK_SECRET: "", STRIPE_BILLING_PRICE_PRO_YEARLY: "prod_x" });
  assert.deepEqual(missing.problems, ["STRIPE_BILLING_WEBHOOK_SECRET", "STRIPE_BILLING_PRICE_PRO_YEARLY"]);
  // Ξεχωριστό από το Connect.
  assert.notEqual(B.BILLING_WEBHOOK_ENV, "STRIPE_CONNECT_WEBHOOK_SECRET");
});

/* ── Συνδρομή Stripe → εταιρία ── */

const row = (extra = {}) => ({
  status: "TRIAL",
  planKey: "starter",
  billingInterval: "month",
  stripeSubId: null,
  billingStatus: "awaiting_checkout",
  trialEndsAt: null,
  pastDueSince: null,
  ...extra,
});
const sub = (extra = {}) => ({ id: "sub_1", status: "active", priceId: "price_pm", trialEnd: null, currentPeriodEnd: 1_800_000_000, cancelAtPeriodEnd: false, ...extra });

test("συνδρομή → εταιρία: πλάνο/διάστημα ΜΟΝΟ από γνωστό price, TRIAL→ACTIVE, ποτέ αναστολή", () => {
  const p = B.subscriptionPatch(row(), sub(), CONFIG.prices, at(0));
  assert.equal(p.billingStatus, "active");
  assert.equal(p.planKey, "pro");
  assert.equal(p.plan, "PRO");
  assert.equal(p.billingInterval, "month");
  assert.equal(p.status, "ACTIVE");
  assert.equal(p.pastDueSince, null);
  const unknown = B.subscriptionPatch(row(), sub({ priceId: "price_άλλο" }), CONFIG.prices, at(0));
  assert.equal(unknown.planKey, undefined);
  const suspended = B.subscriptionPatch(row({ status: "SUSPENDED" }), sub(), CONFIG.prices, at(0));
  assert.equal(suspended.status, undefined);
  const biz = B.subscriptionPatch(row(), sub({ priceId: "price_by" }), CONFIG.prices, at(0));
  assert.equal(biz.plan, "ENTERPRISE");
  assert.equal(biz.billingInterval, "year");
});

test("απλήρωτη: pastDueSince μπαίνει την ΠΡΩΤΗ φορά και κρατιέται· σβήνει με πληρωμή", () => {
  const first = B.subscriptionPatch(row({ billingStatus: "active" }), sub({ status: "past_due" }), CONFIG.prices, at(3));
  assert.equal(first.pastDueSince.getTime(), at(3).getTime());
  const again = B.subscriptionPatch(row({ billingStatus: "past_due", pastDueSince: at(3) }), sub({ status: "past_due" }), CONFIG.prices, at(5));
  assert.equal(again.pastDueSince.getTime(), at(3).getTime());
  const paid = B.subscriptionPatch(row({ billingStatus: "past_due", pastDueSince: at(3) }), sub({ status: "active" }), CONFIG.prices, at(6));
  assert.equal(paid.pastDueSince, null);
});

test("παλιά συνδρομή άλλου id δεν πατά τη ζωντανή· νέα ζωντανή αντικαθιστά ακυρωμένη", () => {
  assert.equal(B.subscriptionPatch(row({ stripeSubId: "sub_new", billingStatus: "active" }), sub({ id: "sub_old", status: "canceled" }), CONFIG.prices), null);
  const adopt = B.subscriptionPatch(row({ stripeSubId: "sub_old", billingStatus: "canceled" }), sub({ id: "sub_new" }), CONFIG.prices);
  assert.equal(adopt.stripeSubId, "sub_new");
});

test("Checkout: χωρίς κωδικό 14 ημ. με κάρτα· ιδρυτής πριν τη λήξη → trial_end· μετά → πληρωμή τώρα με έκπτωση", () => {
  assert.deepEqual(B.checkoutPlan(st("awaiting_checkout"), false, 0, at(0)), { kind: "card_trial", trialDays: 14 });
  const t = st("founder_trial", { trialEndsAt: at(30) });
  assert.deepEqual(B.checkoutPlan(t, true, 12, at(10)), { kind: "trial_until", trialEnd: at(30) });
  // Χωρίς όχημα ακόμα: 30 ημέρες από τώρα
  assert.equal(B.checkoutPlan(st("founder_trial"), true, 12, at(0)).trialEnd.getTime(), at(30).getTime());
  // < 49 ώρες πριν τη λήξη ή μετά: πληρωμή τώρα
  assert.deepEqual(B.checkoutPlan(t, true, 12, at(29)), { kind: "pay_now", founderCoupon: true });
  assert.deepEqual(B.checkoutPlan(t, true, 12, at(40)), { kind: "pay_now", founderCoupon: true });
  assert.deepEqual(B.checkoutPlan(st("canceled"), true, 0, at(400)), { kind: "pay_now", founderCoupon: false });
  assert.equal(B.canStartCheckout("active"), false);
  assert.equal(B.canStartCheckout("founder_trial"), true);
});

/* ── Έκπτωση ιδρυτή: 12 ΠΛΗΡΩΜΕΝΟΙ μήνες ── */

const inv = (extra = {}) => ({
  id: "in_1",
  status: "draft",
  billingReason: "subscription_cycle",
  subscriptionId: "sub_1",
  amountDue: 3900,
  priceId: "price_sm",
  periodEnd: null,
  hasDiscount: false,
  ...extra,
});

test("έκπτωση ανά τιμολόγιο: μόνο κύκλος σε draft, όχι $0 δοκιμής, όχι αναλογική χρέωση, όχι μη ιδρυτής", () => {
  assert.deepEqual(B.founderInvoiceDecision(inv(), true, [], CONFIG.prices, false), { apply: true, months: 1 });
  assert.equal(B.founderInvoiceDecision(inv(), false, [], CONFIG.prices, false).why, "not_founder");
  assert.equal(B.founderInvoiceDecision(inv({ amountDue: 0 }), true, [], CONFIG.prices, false).why, "free");
  assert.equal(B.founderInvoiceDecision(inv({ billingReason: "subscription_update" }), true, [], CONFIG.prices, false).why, "not_cycle");
  assert.equal(B.founderInvoiceDecision(inv({ status: "open" }), true, [], CONFIG.prices, false).why, "not_draft");
  assert.equal(B.founderInvoiceDecision(inv({ hasDiscount: true }), true, [], CONFIG.prices, false).why, "already");
  assert.equal(B.founderInvoiceDecision(inv(), true, [], CONFIG.prices, true).why, "already");
  assert.deepEqual(B.founderInvoiceDecision(inv({ priceId: "price_by" }), true, [], CONFIG.prices, false), { apply: true, months: 12 });
});

test("ακύρωση/αποτυχία τιμολογίου (void) δεν «καίει» μήνα", () => {
  const rows = [...Array(11)].map(() => ({ months: 1, status: "paid" })).concat([{ months: 1, status: "void" }]);
  assert.equal(B.founderMonthsUsed(rows), 11);
  assert.equal(B.founderMonthsLeft(rows), 1);
  assert.equal(B.founderInvoiceDecision(inv(), true, rows, CONFIG.prices, false).apply, true);
});

/**
 * Προσομοίωση «test clock»: ιδρυτής με δοκιμή 30 ημερών (trial_end στο
 * Stripe), μετά μηνιαίοι κύκλοι. ΚΑΘΕ draft τιμολόγιο περνά από το webhook.
 * Αναμένεται: το $0 της δοκιμής ΧΩΡΙΣ έκπτωση, τα 12 πρώτα ΠΛΗΡΩΜΕΝΑ με 50%,
 * το 13ο σε κανονική τιμή — δηλαδή οι 12 μήνες μετρούν από την 1η πληρωμή.
 */
test("timeline: δοκιμή 30 ημ. + 14 κύκλοι → έκπτωση ΑΚΡΙΒΩΣ στις 12 πρώτες πληρωμές", async () => {
  const charged = [];
  const deps = fakeDeps({ isFounder: true });
  // $0 τιμολόγιο της δοκιμής (subscription_create) — δεν μετρά.
  deps.invoices.in_0 = inv({ id: "in_0", amountDue: 0, billingReason: "subscription_create", status: "paid" });
  await handleBillingEvent(ev("invoice.created", { id: "in_0", customer: "cus_1" }), deps);
  for (let k = 1; k <= 14; k++) {
    const id = `in_${k}`;
    deps.invoices[id] = inv({ id, periodEnd: Math.floor(at(30 + 30 * k).getTime() / 1000) });
    await handleBillingEvent(ev("invoice.created", { id, customer: "cus_1" }), deps);
    const discounted = deps.discounted.has(id);
    charged.push(discounted ? B.founderPriceCents(3900) : 3900);
    deps.invoices[id] = { ...deps.invoices[id], status: "paid", hasDiscount: discounted };
    await handleBillingEvent(ev("invoice.paid", { id, customer: "cus_1" }), deps);
  }
  assert.equal(deps.discounted.has("in_0"), false);
  assert.deepEqual(charged, [...Array(12).fill(1950), 3900, 3900]);
  assert.equal(B.founderMonthsPaid(deps.founderRows), 12);
  // Τέλος έκπτωσης = τέλος περιόδου του 12ου τιμολογίου.
  assert.equal(deps.founderEnd.getTime(), at(30 + 30 * 12).getTime());
});

test("ετήσια συνδρομή ιδρυτή: 50% στο ΠΡΩΤΟ ετήσιο τιμολόγιο (12 μήνες), όχι στο δεύτερο", async () => {
  const deps = fakeDeps({ isFounder: true });
  deps.invoices.in_y1 = inv({ id: "in_y1", priceId: "price_sy", amountDue: 39000 });
  await handleBillingEvent(ev("invoice.created", { id: "in_y1", customer: "cus_1" }), deps);
  deps.invoices.in_y2 = inv({ id: "in_y2", priceId: "price_sy", amountDue: 39000 });
  await handleBillingEvent(ev("invoice.created", { id: "in_y2", customer: "cus_1" }), deps);
  assert.deepEqual([...deps.discounted], ["in_y1"]);
});

test("πληρωμή τώρα από Checkout: το 1ο τιμολόγιο (με coupon) μετρά ως πληρωμένος μήνας", async () => {
  const deps = fakeDeps({ isFounder: true });
  deps.invoices.in_c = { ...inv({ id: "in_c", billingReason: "subscription_create", status: "paid", hasDiscount: true }), founderCoupon: true };
  assert.equal(await handleBillingEvent(ev("invoice.paid", { id: "in_c", customer: "cus_1" }), deps), "applied");
  assert.deepEqual(deps.founderRows.map((r) => [r.stripeInvoiceId, r.status, r.months]), [["in_c", "paid", 1]]);
});

/* ── Webhook ── */

function ev(type, object, extra = {}) {
  return { id: `evt_${type}_${object.id ?? "x"}_${Math.random()}`, type, data: { object }, ...extra };
}

function fakeDeps({ isFounder = false, tenant = {} } = {}) {
  const d = {
    config: CONFIG,
    seen: new Set(),
    patches: [],
    discounted: new Set(),
    founderRows: [],
    founderEnd: null,
    invoices: {},
    subs: { sub_1: { ...sub(), customerId: "cus_1", tenantIdMeta: "t1" } },
    tenant: { id: "t1", stripeCustomerId: "cus_1", isFounder, ...row({ stripeSubId: "sub_1", billingStatus: "trialing" }), ...tenant },
    now: () => at(0),
    async eventSeen(id) {
      return d.seen.has(id);
    },
    async markEvent(id) {
      d.seen.add(id);
    },
    async tenantByCustomer(c) {
      return c === d.tenant.stripeCustomerId ? d.tenant : null;
    },
    async retrieveSubscription(id) {
      return d.subs[id];
    },
    async retrieveInvoice(id) {
      return { customerId: "cus_1", founderCoupon: false, ...d.invoices[id] };
    },
    async applyPatch(tenantId, patch) {
      d.patches.push([tenantId, patch]);
      Object.assign(d.tenant, patch);
    },
    async founderInvoices() {
      return d.founderRows;
    },
    async applyFounderDiscount(id) {
      d.discounted.add(id);
    },
    async recordFounderInvoice(r) {
      if (!d.founderRows.some((x) => x.stripeInvoiceId === r.stripeInvoiceId)) d.founderRows.push({ ...r });
    },
    async setFounderInvoiceStatus(id, _t, status) {
      const r = d.founderRows.find((x) => x.stripeInvoiceId === id);
      if (r) r.status = status;
    },
    async setFounderDiscountEnd(_t, end) {
      d.founderEnd = end;
    },
  };
  return d;
}

test("webhook: events Connect αγνοούνται, άγνωστος πελάτης αγνοείται, διπλό event = duplicate", async () => {
  const deps = fakeDeps();
  assert.equal(await handleBillingEvent(ev("customer.subscription.updated", { id: "sub_1", customer: "cus_1" }, { account: "acct_1" }), deps), "ignored_connect");
  assert.equal(await handleBillingEvent(ev("customer.subscription.updated", { id: "sub_1", customer: "cus_άλλος" }), deps), "unknown_customer");
  assert.equal(await handleBillingEvent(ev("charge.refunded", { id: "ch_1", customer: "cus_1" }), deps), "ignored_type");
  const e = ev("customer.subscription.updated", { id: "sub_1", customer: "cus_1" });
  assert.equal(await handleBillingEvent(e, deps), "applied");
  assert.equal(await handleBillingEvent(e, deps), "duplicate");
  assert.equal(deps.patches.length, 1);
});

test("webhook: Checkout άλλης εταιρίας (client_reference_id) ή συνδρομή άλλου πελάτη → mismatch, καμία αλλαγή", async () => {
  const deps = fakeDeps();
  const bad = ev("checkout.session.completed", { id: "cs_1", mode: "subscription", customer: "cus_1", client_reference_id: "t_άλλη", subscription: "sub_1" });
  assert.equal(await handleBillingEvent(bad, deps), "mismatch");
  deps.subs.sub_x = { ...sub({ id: "sub_x" }), customerId: "cus_άλλος", tenantIdMeta: "t1" };
  assert.equal(await handleBillingEvent(ev("customer.subscription.created", { id: "sub_x", customer: "cus_1" }), deps), "mismatch");
  deps.subs.sub_y = { ...sub({ id: "sub_y" }), customerId: "cus_1", tenantIdMeta: "t_άλλη" };
  assert.equal(await handleBillingEvent(ev("customer.subscription.created", { id: "sub_y", customer: "cus_1" }), deps), "mismatch");
  assert.equal(deps.patches.length, 0);
  const good = ev("checkout.session.completed", { id: "cs_2", mode: "subscription", customer: "cus_1", client_reference_id: "t1", subscription: "sub_1" });
  assert.equal(await handleBillingEvent(good, deps), "applied");
});

test("webhook: αποτυχία πληρωμής → past_due· 7 ημέρες μετά → μόνο ανάγνωση· πληρωμή → πλήρης", async () => {
  const deps = fakeDeps({ tenant: { billingStatus: "active", status: "ACTIVE" } });
  deps.subs.sub_1 = { ...deps.subs.sub_1, status: "past_due" };
  deps.invoices.in_f = inv({ id: "in_f", status: "open" });
  await handleBillingEvent(ev("invoice.payment_failed", { id: "in_f", customer: "cus_1" }), deps);
  assert.equal(deps.tenant.billingStatus, "past_due");
  assert.equal(B.billingAccess(deps.tenant, at(6)).mode, "full");
  assert.equal(B.billingAccess(deps.tenant, at(7)).mode, "read_only");
  deps.subs.sub_1 = { ...deps.subs.sub_1, status: "active" };
  deps.invoices.in_f = inv({ id: "in_f", status: "paid" });
  await handleBillingEvent(ev("invoice.paid", { id: "in_f", customer: "cus_1" }), deps);
  assert.equal(B.billingAccess(deps.tenant, at(30)).mode, "full");
});

test("webhook route: υπογραφή με STRIPE_BILLING_WEBHOOK_SECRET στο ακατέργαστο body, ξεχωριστό από το Connect", () => {
  const src = read("src/app/api/billing/webhook/route.ts");
  assert.match(src, /process\.env\.STRIPE_BILLING_WEBHOOK_SECRET/);
  assert.match(src, /constructEvent\(raw, signature, secret\)/);
  assert.match(src, /await req\.text\(\)/);
  assert.doesNotMatch(src, /STRIPE_CONNECT_WEBHOOK_SECRET/);
  // Το Connect webhook δεν άλλαξε: ακόμα μόνο το δικό του secret.
  assert.doesNotMatch(read("src/app/api/stripe/connect/webhook/route.ts"), /BILLING/);
});

/* ── Ειδοποίηση 30 ημέρες πριν ── */

test("ειδοποίηση λήξης έκπτωσης: από (τέλος − 30 ημ.), μία φορά, μόνο με ζωντανή συνδρομή", () => {
  const t = { founderDiscountEndsAt: at(100), founderNoticeSentAt: null, billingStatus: "active" };
  assert.equal(B.founderNoticeDue(t, at(69)), false);
  assert.equal(B.founderNoticeDue(t, at(70)), true);
  assert.equal(B.founderNoticeDue(t, at(100)), false);
  assert.equal(B.founderNoticeDue({ ...t, founderNoticeSentAt: at(70) }, at(80)), false);
  assert.equal(B.founderNoticeDue({ ...t, billingStatus: "canceled" }, at(80)), false);
  const mail = B.founderNoticeEmail("el", "a@b.gr", "Demo", "Pro", at(100), 7900, "month");
  assert.match(mail.subject, /30 ημέρες/);
  assert.match(mail.text.replace(/\s/g, " "), /79 € τον μήνα \(χωρίς ΦΠΑ\)/);
  assert.match(B.founderNoticeEmail("en", "a@b.gr", "Demo", "Pro", at(100), 79000, "year").text, /€790 per year/);
});

/* ── Κωδικοί ιδρυτή + δημόσιο endpoint ── */

test("κωδικός: κανονικοποίηση, hash (ποτέ ο κωδικός στη βάση), μορφή", () => {
  const c = F.generateFounderCode();
  assert.match(c, /^FP-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(F.normalizeFounderCode(" fp-ab2c d3ef "), "FPAB2CD3EF");
  assert.equal(F.hashFounderCode("fp-ab2c-d3ef"), F.hashFounderCode("FPAB2CD3EF"));
  assert.match(F.hashFounderCode(c), /^[0-9a-f]{64}$/);
  assert.equal(F.isFounderCodeShape("x"), false);
  assert.equal(F.isFounderCodeShape("a".repeat(41)), false);
  assert.equal(F.isFounderCodeShape(c), true);
});

test("κωδικός: λάθος / ανενεργός / ληγμένος / εξαντλημένος → ΙΔΙΟ «invalid»· 0 θέσεις → «closed»", () => {
  const ok = { active: true, maxClaims: 1, claimedCount: 0, expiresAt: null };
  assert.equal(F.founderCodeState(ok, 3, at(0)), "ok");
  assert.equal(F.founderCodeState(null, 3, at(0)), "invalid");
  assert.equal(F.founderCodeState({ ...ok, active: false }, 3, at(0)), "invalid");
  assert.equal(F.founderCodeState({ ...ok, expiresAt: at(-1) }, 3, at(0)), "invalid");
  assert.equal(F.founderCodeState({ ...ok, claimedCount: 1 }, 3, at(0)), "invalid");
  assert.equal(F.founderCodeState(ok, 0, at(0)), "closed");
  assert.equal(F.founderCodeState(null, 0, at(0)), "closed");
});

test("θέσεις: ποτέ αρνητικές, ανενεργό πρόγραμμα = 0, μέγιστο 10", () => {
  assert.equal(F.remainingSpots({ maxSlots: 10, claimedCount: 3, active: true }), 7);
  assert.equal(F.remainingSpots({ maxSlots: 10, claimedCount: 10, active: true }), 0);
  assert.equal(F.remainingSpots({ maxSlots: 10, claimedCount: 12, active: true }), 0);
  assert.equal(F.remainingSpots({ maxSlots: 99, claimedCount: 0, active: true }), 10);
  assert.equal(F.remainingSpots({ maxSlots: 10, claimedCount: 0, active: false }), 0);
  assert.equal(F.remainingSpots(null), 0);
});

test("δημόσιο endpoint θέσεων: ΜΟΝΟ { remaining }, όριο ανά IP, κανένα όνομα/κωδικός", () => {
  assert.deepEqual(F.publicSpotsBody(7), { remaining: 7 });
  assert.deepEqual(Object.keys(F.publicSpotsBody(3.7)), ["remaining"]);
  assert.deepEqual(F.publicSpotsBody(-2), { remaining: 0 });
  const src = read("src/app/api/public/founding-spots/route.ts");
  assert.match(src, /LIMITS\.foundingSpotsPerIp/);
  assert.match(src, /NextResponse\.json\(publicSpotsBody\(remaining\)/);
  assert.match(src, /selfSignupEnabled\(\)/);
  assert.match(src, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(src, /founderClaim|founderCode|tenant\.|codeHash|label/);
  // Η ανάγνωση θέσεων διαβάζει μόνο τον μετρητή.
  const server = read("src/lib/billing/foundingServer.ts");
  assert.match(server, /select: \{ maxSlots: true, claimedCount: true, active: true \}/);
});

test("εγγραφή: η θέση διεκδικείται ΜΕΣΑ στη transaction (ατομικά), ουδέτερα μηνύματα από τα λεξικά", () => {
  const s = read("src/lib/signup/signupServer.ts");
  const tx = s.slice(s.indexOf("await db.$transaction(async (tx) => {"), s.indexOf("} catch (e) {", s.indexOf("await db.$transaction(async (tx) => {")));
  assert.match(tx, /claimFounderSlot\(tx, founderCode, tenant\.id\)/);
  assert.match(s, /if \(e instanceof FounderClaimError\) return founderError\(lang, e\.state\)/);
  assert.match(s, /LIMITS\.founderCodePerIp/);
  // Ο έλεγχος κωδικού γίνεται ΠΡΙΝ από τον έλεγχο email (δεν φανερώνει λογαριασμούς).
  assert.ok(s.indexOf("precheckFounderCode(") < s.indexOf("emailInUse(input.email)"));
  const claim = read("src/lib/billing/foundingServer.ts");
  assert.match(claim, /WHERE "id" = \$\{FOUNDING_PROGRAM_ID\} AND "active" AND "claimedCount" < "maxSlots"/);
  assert.match(claim, /AND \("expiresAt" IS NULL OR "expiresAt" > \$\{now\}\)/);
  assert.match(claim, /throw new FounderClaimError\("closed"\)/);
});

test("κείμενα el/en: banner, έκλεισε, λάθος κωδικός, φόρμα γνώμης (ακριβώς όπως ζητήθηκαν)", () => {
  const el = read("src/lib/i18n/el.ts");
  const en = read("src/lib/i18n/en.ts");
  for (const [src, texts] of [
    [el, [
      "Πρόγραμμα πρώτων εταιρειών: 50% έκπτωση για 12 μήνες και 30 ημέρες δωρεάν δοκιμή. Απομένουν {n} από 10 θέσεις.",
      "Το πρόγραμμα πρώτων εταιρειών έκλεισε. Μπορείς να ξεκινήσεις κανονικά με δοκιμή 14 ημερών.",
      "Ο κωδικός δεν είναι έγκυρος.",
      "Τι σε βοήθησε περισσότερο μέχρι τώρα;",
      "Τι σου έλειψε ή σε μπέρδεψε;",
      "Πόσα οχήματα έχει η εταιρεία σου;",
    ]],
    [en, [
      "Founding companies program: 50% off for 12 months and a 30-day free trial. {n} of 10 spots left.",
      "The founding companies program is now closed. You can still start with a 14-day trial.",
      "This code is not valid.",
    ]],
  ]) {
    for (const t of texts) assert.ok(src.includes(`"${t}"`), t);
  }
});

test("γνώμη: προαιρετική, οχήματα ως αριθμός, μόνο η εταιρία/ο χρήστης του session, ορατή στον Super Admin", async () => {
  const { feedbackSchema } = await import("../src/lib/feedback.ts");
  assert.equal(feedbackSchema.safeParse({}).success, false);
  assert.equal(feedbackSchema.safeParse({ helpedMost: "  " }).success, false);
  const ok = feedbackSchema.safeParse({ vehicleCount: 12 });
  assert.equal(ok.success, true);
  assert.equal(feedbackSchema.safeParse({ vehicleCount: "12" }).success, false);
  assert.equal(feedbackSchema.safeParse({ vehicleCount: -1 }).success, false);
  const route = read("src/app/api/feedback/route.ts");
  assert.match(route, /tenantId: viewer\.tenantId/);
  assert.match(route, /userId: viewer\.userId/);
  assert.match(read("src/app/api/super-admin/feedback/route.ts"), /\["SUPER_ADMIN"\]/);
});

test("πρώτο όχημα ξεκινά το ρολόι της δοκιμής ιδρυτή (ατομικά, μία φορά)", () => {
  const v = read("src/app/api/vehicles/route.ts");
  assert.ok(v.indexOf("checkWithinLimit(") < v.indexOf("db.vehicle.create("), "όριο ΠΡΙΝ τη δημιουργία");
  assert.ok(v.indexOf("startFounderClockIfNeeded(") > v.indexOf("db.vehicle.create("));
  const s = read("src/lib/billing/billingServer.ts");
  assert.match(s, /where: \{ id: tenantId, billingStatus: "founder_trial", trialStartedAt: null \}/);
});
