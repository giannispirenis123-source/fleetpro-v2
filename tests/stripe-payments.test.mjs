// tests/stripe-payments.test.mjs
// Online πληρωμές (Stripe Connect, SQL 27): ποσό online (FULL/DEPOSIT,
// στρογγυλοποίηση, ελάχιστο 1 €), επιλογές ανά ρύθμιση και κατάσταση
// λογαριασμού, μεταβάσεις από webhook (completed/expired/refunded,
// idempotency, λάθος εταιρία → αγνόηση), διαθεσιμότητα με ληγμένη αναμονή
// πληρωμής, επιστροφή χρημάτων. Ψεύτικο store — χωρίς βάση, χωρίς δίκτυο.

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

const P = await import("../src/lib/public/payments.ts");
const { handleConnectEvent, checkoutEventOf } = await import("../src/lib/public/paymentWebhook.ts");
const { countAvailableByGroup, freeVehicleIds } = await import("../src/lib/public/availability.ts");
const { missingStripeEnv } = await import("../src/lib/stripeConnectEnv.ts");

/* ─────────────────────────────────────────────
   Ποσά
   ───────────────────────────────────────────── */

test("ποσό online: FULL = όλο το σύνολο", () => {
  assert.equal(P.onlineAmountCents(23_450, "FULL", 30), 23_450);
  assert.deepEqual(P.paymentSplit(23_450, "FULL", 30), { nowCents: 23_450, laterCents: 0 });
});

test("ποσό online: DEPOSIT = ποσοστό στρογγυλό σε ακέραιο €, ελάχιστο 1 €, ποτέ πάνω από το σύνολο", () => {
  assert.equal(P.onlineAmountCents(23_450, "DEPOSIT", 30), 7_000, "70,35 € → 70 €");
  assert.equal(P.onlineAmountCents(23_500, "DEPOSIT", 30), 7_100, "70,50 € → 71 € (half up)");
  assert.deepEqual(P.paymentSplit(23_450, "DEPOSIT", 30), { nowCents: 7_000, laterCents: 16_450 });
  assert.equal(P.onlineAmountCents(1_000, "DEPOSIT", 1), 100, "0,10 € → ελάχιστο 1 €");
  assert.equal(P.onlineAmountCents(80, "DEPOSIT", 50), 80, "σύνολο κάτω από 1 € → όλο, ποτέ παραπάνω");
  assert.equal(P.onlineAmountCents(10_000, "DEPOSIT", 100), 10_000);
  assert.equal(P.onlineAmountCents(10_000, "DEPOSIT", 250), 10_000, "πάνω από 100% → 100%");
  assert.equal(P.onlineAmountCents(0, "DEPOSIT", 30), 0);
});

test("προμήθεια πλατφόρμας: 0 bps → καμία· αλλιώς floor", () => {
  assert.equal(P.applicationFeeCents(10_000, 0), 0);
  assert.equal(P.applicationFeeCents(10_000, 150), 150);
  assert.equal(P.applicationFeeCents(999, 150), 14);
  assert.equal(P.applicationFeeCents(10_000, 99_999), 5_000, "ταβάνι 50%");
});

/* ─────────────────────────────────────────────
   Επιλογές
   ───────────────────────────────────────────── */

const tenant = (over = {}) => ({
  stripeAccountId: "acct_1",
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeDetailsSubmitted: true,
  paymentOptions: "ONLINE_OR_PICKUP",
  onlineAmountType: "DEPOSIT",
  depositPercent: 30,
  ...over,
});

test("κατάσταση λογαριασμού: Δεν έχει συνδεθεί / Εκκρεμεί / Ενεργό", () => {
  assert.equal(P.accountStatus(tenant({ stripeAccountId: null })), "NOT_CONNECTED");
  assert.equal(P.accountStatus(tenant({ stripePayoutsEnabled: false })), "PENDING");
  assert.equal(P.accountStatus(tenant({ stripeChargesEnabled: false })), "PENDING");
  assert.equal(P.accountStatus(tenant()), "ACTIVE");
});

test("επιλογές: online ΜΟΝΟ με ενεργό λογαριασμό ΚΑΙ ρυθμισμένο server· αλλιώς στην παραλαβή", () => {
  assert.equal(P.effectivePaymentOptions(tenant(), true), "ONLINE_OR_PICKUP");
  assert.equal(P.effectivePaymentOptions(tenant({ paymentOptions: "ONLINE_ONLY" }), true), "ONLINE_ONLY");
  assert.equal(P.effectivePaymentOptions(tenant(), false), "PICKUP_ONLY", "λείπουν κλειδιά");
  assert.equal(P.effectivePaymentOptions(tenant({ stripePayoutsEnabled: false }), true), "PICKUP_ONLY", "εκκρεμεί");
  assert.equal(P.effectivePaymentOptions(tenant({ stripeAccountId: null }), true), "PICKUP_ONLY");
  assert.equal(P.effectivePaymentOptions(tenant({ paymentOptions: "κάτι" }), true), "PICKUP_ONLY");
  assert.deepEqual(P.availableMethods("PICKUP_ONLY"), ["PICKUP"]);
  assert.deepEqual(P.availableMethods("ONLINE_OR_PICKUP"), ["ONLINE", "PICKUP"]);
  assert.deepEqual(P.availableMethods("ONLINE_ONLY"), ["ONLINE"]);
});

test("τρόπος πληρωμής: με δύο επιλογές ΥΠΟΧΡΕΩΤΙΚΗ ρητή επιλογή· με μία, αυτή", () => {
  assert.equal(P.resolvePaymentMethod(undefined, "ONLINE_OR_PICKUP").ok, false);
  assert.equal(P.resolvePaymentMethod("", "ONLINE_OR_PICKUP").ok, false);
  assert.equal(P.resolvePaymentMethod("CARD", "ONLINE_OR_PICKUP").ok, false);
  assert.deepEqual(P.resolvePaymentMethod("ONLINE", "ONLINE_OR_PICKUP"), { ok: true, method: "ONLINE" });
  assert.deepEqual(P.resolvePaymentMethod("PICKUP", "ONLINE_OR_PICKUP"), { ok: true, method: "PICKUP" });
  assert.deepEqual(P.resolvePaymentMethod("ONLINE", "PICKUP_ONLY"), { ok: true, method: "PICKUP" }, "online χωρίς ενεργό λογαριασμό → παραλαβή");
  assert.deepEqual(P.resolvePaymentMethod(undefined, "ONLINE_ONLY"), { ok: true, method: "ONLINE" });
  assert.equal(P.resolvePaymentMethod(undefined, "ONLINE_OR_PICKUP").message.el, "Διαλέξτε τρόπο πληρωμής.");
});

test("env: λείπει → όνομα (ποτέ τιμή), κενό = λείπει", () => {
  assert.deepEqual(missingStripeEnv({}), ["STRIPE_SECRET_KEY", "STRIPE_CONNECT_WEBHOOK_SECRET"]);
  assert.deepEqual(missingStripeEnv({ STRIPE_SECRET_KEY: "  ", STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_x" }), ["STRIPE_SECRET_KEY"]);
  assert.deepEqual(missingStripeEnv({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_x" }), []);
});

/* ─────────────────────────────────────────────
   Webhook
   ───────────────────────────────────────────── */

function fakeStore(init = {}) {
  const state = {
    events: new Set(),
    tenants: [
      { id: "T1", account: "acct_1", rentalMode: "BOOKING" },
      { id: "T2", account: "acct_2", rentalMode: "REQUEST" },
    ],
    bookings: [
      { id: "B1", tenantId: "T1", vehicleId: "v1", status: "PENDING", paymentStatus: "AWAITING_PAYMENT" },
      { id: "B2", tenantId: "T2", vehicleId: "v9", status: "PENDING", paymentStatus: "AWAITING_PAYMENT" },
    ],
    payments: [
      { id: "P1", tenantId: "T1", bookingId: "B1", session: "cs_1", intent: null, status: "OPEN", amountCents: 7000, refundedCents: 0 },
      { id: "P2", tenantId: "T2", bookingId: "B2", session: "cs_2", intent: null, status: "OPEN", amountCents: 5000, refundedCents: 0 },
    ],
    accounts: {},
    ...init,
  };
  const store = {
    run: async (fn) => {
      // Όλα-ή-τίποτα: αντίγραφο, και επαναφορά σε exception.
      const snap = structuredClone({ ...state, events: [...state.events] });
      try {
        return await fn({});
      } catch (e) {
        Object.assign(state, { ...snap, events: new Set(snap.events) });
        throw e;
      }
    },
    markEvent: async (_tx, e) => (state.events.has(e.id) ? false : (state.events.add(e.id), true)),
    tenantByAccount: async (_tx, acct) => {
      const t = state.tenants.find((x) => x.account === acct);
      return t ? { id: t.id, rentalMode: t.rentalMode } : null;
    },
    paymentBySession: async (_tx, tenantId, session) => state.payments.find((p) => p.tenantId === tenantId && p.session === session) ?? null,
    paymentByIntent: async (_tx, tenantId, intent) => state.payments.find((p) => p.tenantId === tenantId && p.intent === intent) ?? null,
    booking: async (_tx, tenantId, id) => state.bookings.find((b) => b.tenantId === tenantId && b.id === id) ?? null,
    applyTransition: async (_tx, b, p, t) => {
      const bk = state.bookings.find((x) => x.id === b.id);
      Object.assign(bk, { paymentStatus: t.booking.paymentStatus }, t.booking.status ? { status: t.booking.status } : {});
      if (t.booking.cancelReasonCode) bk.cancelReasonCode = t.booking.cancelReasonCode;
      const pm = state.payments.find((x) => x.id === p.id);
      pm.status = t.payment.status;
      if (t.payment.refundedCents !== undefined) pm.refundedCents = t.payment.refundedCents;
      if (t.payment.paymentIntentId) pm.intent = t.payment.paymentIntentId;
      if (t.needsRefund) pm.needsRefund = true;
    },
    updateAccount: async (_tx, tenantId, flags) => {
      state.accounts[tenantId] = flags;
    },
  };
  return { state, store };
}

const session = (over = {}) => ({
  id: "cs_1",
  object: "checkout.session",
  payment_status: "paid",
  amount_total: 7000,
  currency: "eur",
  payment_intent: "pi_1",
  metadata: { bookingId: "B1", tenantId: "T1", bookingCode: "ABCD-EFGH" },
  ...over,
});
const ev = (id, type, object, account = "acct_1") => ({ id, type, account, data: { object } });

test("webhook completed: PAID ΜΟΝΟ με σωστό ποσό· BOOKING → CONFIRMED", async () => {
  const { state, store } = fakeStore();
  assert.equal(await handleConnectEvent(ev("evt_1", "checkout.session.completed", session()), store), "applied");
  assert.deepEqual(
    { ...state.bookings[0] },
    { id: "B1", tenantId: "T1", vehicleId: "v1", status: "CONFIRMED", paymentStatus: "PAID" }
  );
  assert.equal(state.payments[0].status, "PAID");
  assert.equal(state.payments[0].intent, "pi_1");
});

test("webhook completed σε REQUEST: μένει PENDING για επιβεβαίωση, με «Πληρωμένο»", async () => {
  const { state, store } = fakeStore();
  const s = session({ id: "cs_2", amount_total: 5000, metadata: { bookingId: "B2", tenantId: "T2" } });
  assert.equal(await handleConnectEvent(ev("evt_2", "checkout.session.completed", s, "acct_2"), store), "applied");
  assert.equal(state.bookings[1].status, "PENDING");
  assert.equal(state.bookings[1].paymentStatus, "PAID");
});

test("webhook: διαφορετικό ποσό ή νόμισμα → ΔΕΝ γίνεται PAID", async () => {
  const { state, store } = fakeStore();
  assert.equal(await handleConnectEvent(ev("evt_3", "checkout.session.completed", session({ amount_total: 6999 })), store), "amount_mismatch");
  assert.equal(await handleConnectEvent(ev("evt_4", "checkout.session.completed", session({ currency: "usd" })), store), "amount_mismatch");
  assert.equal(state.bookings[0].paymentStatus, "AWAITING_PAYMENT");
  assert.equal(state.payments[0].status, "OPEN");
});

test("webhook: ίδιο event δύο φορές → εφαρμόζεται ΜΙΑ", async () => {
  const { state, store } = fakeStore();
  const e = ev("evt_5", "checkout.session.completed", session());
  assert.equal(await handleConnectEvent(e, store), "applied");
  // Η εταιρία αλλάζει την κατάσταση· η επανάληψη του event ΔΕΝ την πατά.
  state.bookings[0].status = "ACTIVE";
  assert.equal(await handleConnectEvent(e, store), "duplicate");
  assert.equal(state.bookings[0].status, "ACTIVE");
});

test("webhook: λάθος εταιρία → αγνόηση (metadata άλλου tenant, άγνωστος λογαριασμός, ξένη session)", async () => {
  const { state, store } = fakeStore();
  // Ο λογαριασμός της T1 στέλνει session με metadata της T2.
  const foreign = session({ id: "cs_2", amount_total: 5000, metadata: { bookingId: "B2", tenantId: "T2" } });
  assert.equal(await handleConnectEvent(ev("evt_6", "checkout.session.completed", foreign, "acct_1"), store), "mismatch");
  // Σωστά metadata της T1 αλλά session της T2.
  const crossed = session({ id: "cs_2" });
  assert.equal(await handleConnectEvent(ev("evt_7", "checkout.session.completed", crossed), store), "not_found");
  // bookingId που δεν ανήκει στη session.
  assert.equal(await handleConnectEvent(ev("evt_8", "checkout.session.completed", session({ metadata: { bookingId: "B2", tenantId: "T1" } })), store), "mismatch");
  assert.equal(await handleConnectEvent(ev("evt_9", "checkout.session.completed", session(), "acct_unknown"), store), "unknown_account");
  assert.equal(await handleConnectEvent(ev("evt_10", "checkout.session.completed", session(), null), store), "unknown_account");
  assert.ok(state.bookings.every((b) => b.paymentStatus === "AWAITING_PAYMENT"), "καμία αλλαγή");
});

test("webhook expired: EXPIRED + αυτόματη ακύρωση (ελευθερώνει το όχημα)· μετά από PAID → τίποτα", async () => {
  const { state, store } = fakeStore();
  assert.equal(await handleConnectEvent(ev("evt_11", "checkout.session.expired", session({ payment_status: "unpaid" })), store), "applied");
  assert.equal(state.bookings[0].status, "CANCELLED");
  assert.equal(state.bookings[0].paymentStatus, "EXPIRED");
  assert.equal(state.bookings[0].cancelReasonCode, P.PAYMENT_CANCEL_REASON);
  assert.equal(state.payments[0].status, "EXPIRED");

  const paid = fakeStore();
  await handleConnectEvent(ev("evt_12", "checkout.session.completed", session()), paid.store);
  assert.equal(await handleConnectEvent(ev("evt_13", "checkout.session.expired", session()), paid.store), "noop");
  assert.equal(paid.state.bookings[0].status, "CONFIRMED");
});

test("webhook async: completed με unpaid περιμένει· async_succeeded → PAID· async_failed → ακύρωση", async () => {
  const a = fakeStore();
  assert.equal(await handleConnectEvent(ev("evt_14", "checkout.session.completed", session({ payment_status: "unpaid" })), a.store), "pending");
  assert.equal(a.state.bookings[0].paymentStatus, "AWAITING_PAYMENT");
  assert.equal(await handleConnectEvent(ev("evt_15", "checkout.session.async_payment_succeeded", session()), a.store), "applied");
  assert.equal(a.state.bookings[0].paymentStatus, "PAID");

  const f = fakeStore();
  assert.equal(await handleConnectEvent(ev("evt_16", "checkout.session.async_payment_failed", session()), f.store), "applied");
  assert.equal(f.state.bookings[0].status, "CANCELLED");
  assert.equal(f.state.bookings[0].paymentStatus, "FAILED");
});

test("webhook: πληρωμή που ήρθε ΜΕΤΑ την ακύρωση → PAID, κράτηση μένει ακυρωμένη, σημαία επιστροφής", async () => {
  const { state, store } = fakeStore();
  state.bookings[0].status = "CANCELLED";
  assert.equal(await handleConnectEvent(ev("evt_17", "checkout.session.completed", session()), store), "applied");
  assert.equal(state.bookings[0].status, "CANCELLED");
  assert.equal(state.bookings[0].paymentStatus, "PAID");
  assert.equal(state.payments[0].needsRefund, true);
});

test("webhook charge.refunded: μερική → ολική, idempotent, μόνο πληρωμή της ίδιας εταιρίας", async () => {
  const { state, store } = fakeStore();
  await handleConnectEvent(ev("evt_18", "checkout.session.completed", session()), store);
  const charge = (amount_refunded) => ({ id: "ch_1", object: "charge", payment_intent: "pi_1", amount_refunded });
  assert.equal(await handleConnectEvent(ev("evt_19", "charge.refunded", charge(2000)), store), "applied");
  assert.equal(state.payments[0].status, "PARTIALLY_REFUNDED");
  assert.equal(state.payments[0].refundedCents, 2000);
  assert.equal(state.bookings[0].paymentStatus, "PARTIALLY_REFUNDED");
  assert.equal(await handleConnectEvent(ev("evt_20", "charge.refunded", charge(2000)), store), "noop", "ίδιο σύνολο (π.χ. ήδη από το dashboard)");
  assert.equal(await handleConnectEvent(ev("evt_21", "charge.refunded", charge(7000)), store), "applied");
  assert.equal(state.payments[0].status, "REFUNDED");
  assert.equal(state.bookings[0].paymentStatus, "REFUNDED");
  assert.equal(await handleConnectEvent(ev("evt_22", "charge.refunded", charge(7000), "acct_2"), store), "not_found", "λογαριασμός άλλης εταιρίας");
});

test("webhook account.updated: ενημερώνει ΜΟΝΟ τον λογαριασμό του event", async () => {
  const { state, store } = fakeStore();
  const acct = { id: "acct_1", object: "account", charges_enabled: true, payouts_enabled: false, details_submitted: true };
  assert.equal(await handleConnectEvent(ev("evt_23", "account.updated", acct), store), "applied");
  assert.deepEqual(state.accounts.T1, { stripeChargesEnabled: true, stripePayoutsEnabled: false, stripeDetailsSubmitted: true });
  assert.equal(await handleConnectEvent(ev("evt_24", "account.updated", { ...acct, id: "acct_2" }), store), "mismatch");
  assert.equal(state.accounts.T2, undefined);
  assert.equal(await handleConnectEvent(ev("evt_25", "customer.created", {}), store), "ignored_type");
});

test("webhook: αποτυχία στη μέση → τίποτα δεν μένει (ούτε το event), άρα το Stripe ξαναδοκιμάζει", async () => {
  const { state, store } = fakeStore();
  const broken = { ...store, applyTransition: async () => { throw new Error("db"); } };
  await assert.rejects(handleConnectEvent(ev("evt_26", "checkout.session.completed", session()), broken));
  assert.equal(state.events.has("evt_26"), false);
  assert.equal(await handleConnectEvent(ev("evt_26", "checkout.session.completed", session()), store), "applied");
});

test("checkoutEventOf: payment_intent ως id ή αντικείμενο", () => {
  assert.equal(checkoutEventOf("checkout.session.completed", session({ payment_intent: { id: "pi_9" } })).paymentIntentId, "pi_9");
  assert.equal(checkoutEventOf("checkout.session.completed", session({ payment_status: "unpaid" })), null);
});

/* ─────────────────────────────────────────────
   Διαθεσιμότητα
   ───────────────────────────────────────────── */

test("διαθεσιμότητα: AWAITING_PAYMENT κρατά το όχημα ΜΕΧΡΙ τη λήξη· μετά ελευθερώνεται (και χωρίς webhook)", () => {
  const now = Date.parse("2026-11-01T10:00:00.000Z");
  const base = {
    companyId: "T1",
    vehicles: [{ id: "v1", tenantId: "T1", groupKey: "g.A", status: "AVAILABLE", isActive: true }],
    from: "2026-11-10T10:00",
    to: "2026-11-12T10:00",
    prepMinutes: 0,
    instantMs: now,
  };
  const hold = (expiresMs) => ({
    tenantId: "T1", vehicleId: "v1", status: "PENDING", pickupDate: "2026-11-10", pickupTime: "10:00", returnDate: "2026-11-12", returnTime: "10:00",
    paymentStatus: "AWAITING_PAYMENT", paymentExpiresMs: expiresMs,
  });
  assert.equal(countAvailableByGroup({ ...base, bookings: [hold(now + 60_000)] }).get("g.A"), 0, "σε ισχύ");
  assert.equal(countAvailableByGroup({ ...base, bookings: [hold(now - 1)] }).get("g.A"), 1, "έληξε");
  assert.deepEqual(freeVehicleIds({ ...base, bookings: [hold(now)] }, "g.A"), ["v1"], "στο όριο = έληξε");
  // PAID / στην παραλαβή: κρατούν κανονικά.
  assert.equal(countAvailableByGroup({ ...base, bookings: [{ ...hold(now - 1), paymentStatus: "PAID" }] }).get("g.A"), 0);
  assert.equal(countAvailableByGroup({ ...base, bookings: [{ ...hold(null), paymentStatus: "NONE" }] }).get("g.A"), 0);
  assert.equal(P.holdExpired({ paymentStatus: "AWAITING_PAYMENT", paymentExpiresMs: null }, now), false);
});

test("όλα τα ερωτήματα συγκρούσεων εξαιρούν τη ληγμένη αναμονή (site, dashboard, walk-in)", () => {
  for (const f of ["../src/lib/public/availability.ts", "../src/lib/bookingConflicts.ts", "../src/lib/walkIn.ts"]) {
    assert.match(readFileSync(new URL(f, import.meta.url), "utf8"), /notExpiredHold\(/, f);
  }
  assert.deepEqual(P.notExpiredHold(new Date(0)), { NOT: { paymentStatus: "AWAITING_PAYMENT", paymentExpiresAt: { lte: new Date(0) } } });
});

/* ─────────────────────────────────────────────
   Επιστροφή χρημάτων
   ───────────────────────────────────────────── */

test("επιστροφή: μόνο Διαχειριστής, μόνο ακυρωμένη, έως το υπόλοιπο", () => {
  assert.equal(P.canRefund("COMPANY_ADMIN"), true);
  assert.equal(P.canRefund("SUPER_ADMIN"), false);
  assert.equal(P.canRefund("PARTNER"), false);
  assert.equal(P.canRefund("STAFF"), false);
  const paid = { status: "PAID", amountCents: 7000, refundedCents: 0 };
  assert.equal(P.checkRefund(null, paid, null).status, 404);
  assert.equal(P.checkRefund({ status: "CONFIRMED" }, paid, null).message, P.REFUND_MSG.notCancelled);
  assert.deepEqual(P.checkRefund({ status: "CANCELLED" }, paid, null), { ok: true, amountCents: 7000 }, "κενό = όλο");
  assert.deepEqual(P.checkRefund({ status: "CANCELLED" }, paid, 2500), { ok: true, amountCents: 2500 });
  assert.equal(P.checkRefund({ status: "CANCELLED" }, paid, 7001).ok, false);
  assert.equal(P.checkRefund({ status: "CANCELLED" }, paid, 0).ok, false);
  assert.equal(P.checkRefund({ status: "CANCELLED" }, { ...paid, status: "PARTIALLY_REFUNDED", refundedCents: 2500 }, 4501).ok, false);
  assert.equal(P.checkRefund({ status: "CANCELLED" }, { ...paid, status: "REFUNDED", refundedCents: 7000 }, null).message, P.REFUND_MSG.notPaid);
  assert.equal(P.checkRefund({ status: "CANCELLED" }, { ...paid, status: "OPEN" }, null).message, P.REFUND_MSG.notPaid);
});

test("ένδειξη πληρωμής: παραλαβή / αναμονή / πληρώθηκε / επιστροφή / δεν ολοκληρώθηκε", () => {
  const now = 1_000;
  assert.equal(P.paymentBadge({ paymentMethod: null, paymentStatus: "NONE" }, now, null), null);
  assert.equal(P.paymentBadge({ paymentMethod: "PICKUP", paymentStatus: "NONE" }, now, null), "PICKUP");
  assert.equal(P.paymentBadge({ paymentMethod: "ONLINE", paymentStatus: "AWAITING_PAYMENT" }, now, 2_000), "AWAITING");
  assert.equal(P.paymentBadge({ paymentMethod: "ONLINE", paymentStatus: "AWAITING_PAYMENT" }, now, 500), "NOT_COMPLETED");
  assert.equal(P.paymentBadge({ paymentMethod: "ONLINE", paymentStatus: "PAID" }, now, null), "PAID");
  assert.equal(P.paymentBadge({ paymentMethod: "ONLINE", paymentStatus: "PARTIALLY_REFUNDED" }, now, null), "PARTIAL_REFUND");
  assert.equal(P.paymentBadge({ paymentMethod: "ONLINE", paymentStatus: "REFUNDED" }, now, null), "REFUNDED");
  assert.equal(P.paymentBadge({ paymentMethod: "ONLINE", paymentStatus: "EXPIRED" }, now, null), "NOT_COMPLETED");
  assert.equal(P.stripeDashboardPaymentUrl("pi_123", false), "https://dashboard.stripe.com/test/payments/pi_123");
  assert.equal(P.stripeDashboardPaymentUrl("pi_123", true), "https://dashboard.stripe.com/payments/pi_123");
  assert.equal(P.stripeDashboardPaymentUrl("javascript:alert(1)", true), null);
});

/* ─────────────────────────────────────────────
   Μηνύματα, σελίδα κράτησης, εγγραφή
   ───────────────────────────────────────────── */

const { buildBookingMessage } = await import("../src/lib/bookingMessages.ts");
const { toConfirmationDTO } = await import("../src/lib/public/bookingRequest.ts");
const { writeSiteBooking } = await import("../src/lib/public/bookingWrite.ts");

const msgData = (over = {}) => ({
  kind: "confirm",
  lang: "en",
  code: "T7NF-TV74",
  firstName: "Maria",
  groupName: "Category B",
  groupSimilar: null,
  from: "2026-12-11T10:00",
  to: "2026-12-15T10:00",
  pickupLocation: "Chania Airport",
  returnLocation: "Chania Airport",
  totalCents: 23_450,
  company: { name: "Fleet-Pro Car Rental", phone: null, email: null },
  bookingUrl: null,
  searchUrl: null,
  ...over,
});

test("μήνυμα πελάτη: πληρωμή online + υπόλοιπο· χωρίς online → «στην παραλαβή»", () => {
  const paid = buildBookingMessage(msgData({ payment: { paidCents: 7_000, refundedCents: 0 } })).text;
  assert.match(paid, /Paid online: €70/);
  assert.match(paid, /Balance on pick-up: €164\.50/);
  assert.doesNotMatch(paid, /Payment at pick-up\./);
  const full = buildBookingMessage(msgData({ payment: { paidCents: 23_450, refundedCents: 0 } })).text;
  assert.doesNotMatch(full, /Balance on pick-up/);
  assert.match(buildBookingMessage(msgData()).text, /Payment at pick-up\./);
  const el = buildBookingMessage(msgData({ lang: "el", payment: { paidCents: 7_000, refundedCents: 0 } })).text;
  assert.match(el, /Πληρώθηκαν online: 70/);
});

test("μήνυμα ακύρωσης: πληρωμένη → «θα επιστραφεί»· μετά την επιστροφή → «επιστράφηκαν»", () => {
  const pending = buildBookingMessage(msgData({ kind: "cancel", payment: { paidCents: 7_000, refundedCents: 0 } })).text;
  assert.match(pending, /online payment of €70 will be refunded/);
  const done = buildBookingMessage(msgData({ kind: "cancel", payment: { paidCents: 7_000, refundedCents: 7_000 } })).text;
  assert.match(done, /€70 has been refunded to your card/);
  assert.doesNotMatch(buildBookingMessage(msgData({ kind: "cancel" })).text, /refund/i);
  assert.match(buildBookingMessage(msgData({ kind: "cancel", lang: "el", reasonCode: P.PAYMENT_CANCEL_REASON })).text, /Δεν ολοκληρώθηκε η online πληρωμή/);
});

const confSource = (over = {}) => ({
  publicCode: "ABCD-EFGH",
  status: "PENDING",
  pickupDate: new Date("2026-12-11T00:00:00.000Z"),
  pickupTime: "10:00",
  returnDate: new Date("2026-12-15T00:00:00.000Z"),
  returnTime: "10:00",
  pickupLocation: "A",
  returnLocation: "A",
  priceQuote: { version: 1, totalCents: 23_450, quote: { lines: [] } },
  total: 234.5,
  customer: { firstName: "Maria", email: "maria@example.com" },
  groupName: "B",
  groupSimilar: null,
  photoUrl: null,
  ...over,
});

test("σελίδα κράτησης: αναμονή με κουμπί ΜΟΝΟ όσο ζει η συνεδρία· πληρώθηκε + υπόλοιπο· χωρίς στοιχεία κάρτας", () => {
  const now = Date.parse("2026-11-01T10:00:00.000Z");
  const later = new Date(now + 20 * 60_000);
  const waiting = toConfirmationDTO(
    confSource({
      paymentMethod: "ONLINE",
      paymentStatus: "AWAITING_PAYMENT",
      paymentExpiresAt: later,
      payment: { status: "OPEN", amountCents: 7_000, refundedCents: 0, checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_1", expiresAt: later },
    }),
    now
  ).payment;
  assert.equal(waiting.badge, "AWAITING");
  assert.equal(waiting.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_test_1");
  assert.deepEqual(Object.keys(waiting).sort(), ["amountCents", "badge", "balanceCents", "checkoutUrl", "expiresAt", "refundedCents"]);

  const expired = toConfirmationDTO(
    confSource({
      paymentMethod: "ONLINE",
      paymentStatus: "AWAITING_PAYMENT",
      paymentExpiresAt: new Date(now - 1),
      payment: { status: "OPEN", amountCents: 7_000, refundedCents: 0, checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_1", expiresAt: new Date(now - 1) },
    }),
    now
  ).payment;
  assert.equal(expired.badge, "NOT_COMPLETED");
  assert.equal(expired.checkoutUrl, null);

  const foreignUrl = toConfirmationDTO(
    confSource({
      paymentMethod: "ONLINE",
      paymentStatus: "AWAITING_PAYMENT",
      paymentExpiresAt: later,
      payment: { status: "OPEN", amountCents: 7_000, refundedCents: 0, checkoutUrl: "https://evil.example/pay", expiresAt: later },
    }),
    now
  ).payment;
  assert.equal(foreignUrl.checkoutUrl, null, "μόνο checkout.stripe.com");

  const paid = toConfirmationDTO(
    confSource({ status: "CONFIRMED", paymentMethod: "ONLINE", paymentStatus: "PAID", payment: { status: "PAID", amountCents: 7_000, refundedCents: 0, checkoutUrl: null, expiresAt: null } }),
    now
  ).payment;
  assert.equal(paid.badge, "PAID");
  assert.equal(paid.balanceCents, 16_450);
  assert.equal(toConfirmationDTO(confSource({ paymentMethod: "PICKUP", paymentStatus: "NONE" }), now).payment, null);
  assert.equal(toConfirmationDTO(confSource(), now).payment, null, "παλιά κράτηση");
});

test("εγγραφή: ONLINE → AWAITING_PAYMENT με λήξη· PICKUP → NONE· χωρίς πληρωμή → τίποτα (όπως πριν)", async () => {
  const run = async (payment) => {
    const created = [];
    const tx = {
      customer: { findFirst: async () => ({ id: "c1" }), create: async () => ({ id: "c2" }) },
      booking: { findUnique: async () => null, create: async (a) => (created.push(a.data), { id: "b1" }) },
      notification: { create: async (a) => created.push({ notification: a.data.title }) },
    };
    const plan = { vehicleId: "v1", rentalGroupId: null, breakdown: { dailyRate: 1, totalDays: 1, subtotal: 1, extrasTotal: 0, insuranceCost: 0, discountAmount: 0, total: 1, lines: [] }, stored: {} };
    await writeSiteBooking(
      tx,
      { tenantId: "T1", plan, contact: { firstName: "A", lastName: "B", email: "a@b.c", phone: "1", birthDate: "1990-01-01", flightNumber: null, notes: null }, locations: { pickup: "X", dropoff: "X" }, window: { from: "2026-12-11T10:00", to: "2026-12-12T10:00" }, payment },
      { nextNumber: async () => "BP-1", generateCode: () => "AAAA-BBBB" }
    );
    return created;
  };
  const exp = new Date("2026-11-01T10:31:00.000Z");
  const [online, onlineNote] = await run({ method: "ONLINE", expiresAt: exp });
  assert.equal(online.status, "PENDING");
  assert.equal(online.paymentMethod, "ONLINE");
  assert.equal(online.paymentStatus, "AWAITING_PAYMENT");
  assert.equal(online.paymentExpiresAt, exp);
  assert.match(onlineNote.notification, /αναμονή online πληρωμής/);
  const [pickup] = await run({ method: "PICKUP", expiresAt: null });
  assert.equal(pickup.paymentStatus, "NONE");
  assert.equal(pickup.paymentExpiresAt, null);
  const [legacy] = await run(undefined);
  assert.ok(!("paymentStatus" in legacy) && !("paymentMethod" in legacy));
});

/* ─────────────────────────────────────────────
   Ασφάλεια (κώδικας)
   ───────────────────────────────────────────── */

const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

test("webhook: υπογραφή στο ακατέργαστο body, χωρίς δεδομένα πελάτη στα logs", () => {
  const route = src("../src/app/api/stripe/connect/webhook/route.ts");
  assert.match(route, /await req\.text\(\)/);
  assert.match(route, /webhooks\.constructEvent\(raw, signature, secret\)/);
  assert.match(route, /STRIPE_CONNECT_WEBHOOK_SECRET/);
  assert.doesNotMatch(route, /console\.\w+\([^)]*(email|customer|metadata|amount)/i);
});

test("ρυθμίσεις πληρωμών: μόνο Διαχειριστής με publicSite· η προμήθεια ΔΕΝ φεύγει προς την εταιρία ή το site", () => {
  for (const f of ["payments/route.ts", "payments/connect/route.ts", "payments/login-link/route.ts"]) {
    const s = src(`../src/app/api/public-site/${f}`);
    const handlers = s.match(/export const (GET|POST|PATCH|DELETE) =/g) ?? [];
    const guarded = s.match(/export const (GET|POST|PATCH|DELETE) = withPublicSite\(/g) ?? [];
    assert.ok(handlers.length > 0 && handlers.length === guarded.length, f);
    assert.doesNotMatch(s, /platformFeeBps/, f);
  }
  assert.doesNotMatch(JSON.stringify(P.paymentSettingsSchema.shape), /platformFee/);
  assert.equal(P.paymentSettingsSchema.safeParse({ paymentOptions: "ONLINE_ONLY", onlineAmountType: "DEPOSIT", depositPercent: 0 }).success, false);
  assert.equal(P.paymentSettingsSchema.safeParse({ paymentOptions: "ONLINE_ONLY", onlineAmountType: "DEPOSIT", depositPercent: 30.5 }).success, false);
  assert.equal(P.paymentSettingsSchema.safeParse({ paymentOptions: "ONLINE_ONLY", onlineAmountType: "DEPOSIT", depositPercent: 30 }).success, true);
});

test("επιστροφή χρημάτων: ρόλος ΠΡΙΝ από οτιδήποτε, μόνο κράτηση της εταιρίας, ποτέ αυτόματα", () => {
  const route = src("../src/app/api/bookings/[id]/refund/route.ts");
  assert.ok(route.indexOf("canRefund(viewer.role)") < route.indexOf("db."), "403 πριν από κάθε ερώτημα");
  assert.match(route, /where: \{ id, tenantId \}/);
  assert.match(route, /where: \{ tenantId, bookingId: id/);
  // Καμία επιστροφή από ακύρωση/webhook.
  for (const f of ["../src/lib/bookingDecision.ts", "../src/lib/bookingDecisionServer.ts", "../src/lib/public/paymentWebhook.ts"]) {
    assert.doesNotMatch(src(f), /refunds\.create/, f);
  }
});

test("κλειδιά: μόνο από env, ποτέ NEXT_PUBLIC για το secret, ποτέ κάρτα στη βάση", () => {
  for (const f of ["../src/lib/stripeConnect.ts", "../src/lib/public/paymentServer.ts", "../src/app/api/stripe/connect/webhook/route.ts"]) {
    const s = src(f);
    assert.doesNotMatch(s, /sk_(test|live)_[A-Za-z0-9]/, f);
    assert.doesNotMatch(s, /NEXT_PUBLIC_STRIPE_SECRET|NEXT_PUBLIC_STRIPE_CONNECT/, f);
  }
  const sql = src("../prisma/sql/27-stripe-connect.sql");
  assert.doesNotMatch(sql, /card_?number|cvc|cvv|last4|exp_month/i);
  assert.match(sql, /SELECT\s+\(SELECT count\(\*\)/);
});

test("ποσό χρέωσης ΜΟΝΟ από την αποθηκευμένη priceQuote (server), ποτέ από τον browser", () => {
  const s = src("../src/lib/public/paymentServer.ts");
  assert.match(s, /priceQuote/);
  assert.match(s, /onlineAmountCents\(totalCents/);
  const schema = src("../src/lib/public/bookingRequest.ts");
  assert.doesNotMatch(schema.slice(schema.indexOf("publicBookingSchema"), schema.indexOf("export type PublicBookingInput")), /amount|cents/i);
});
