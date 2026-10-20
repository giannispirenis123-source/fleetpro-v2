// tests/contract-card-stripe.test.mjs
// Πληρωμή ενοικίου του συμβολαίου με κάρτα μέσω Stripe Connect (SQL 29):
// ποσό ΜΟΝΟ από τον server, ολοκλήρωση ΜΟΝΟ με επιβεβαιωμένη πληρωμή,
// κανένα στοιχείο κάρτας στις νέες πληρωμές, απομόνωση εταιριών.
// Καθαρή λογική + στατικοί έλεγχοι + ψεύτικο store — χωρίς βάση, χωρίς δίκτυο.

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

const C = await import("../src/lib/contractPaymentCore.ts");
const P = await import("../src/lib/public/payments.ts");
const { handleConnectEvent } = await import("../src/lib/public/paymentWebhook.ts");

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-20T10:00:00Z");

/* ── Ποσό από τον server ── */

test("ποσό: σύνολο κράτησης (από τη βάση) μείον ό,τι πληρώθηκε ήδη online στο site", () => {
  assert.equal(C.contractAmountDueCents("234.50", []), 23_450);
  assert.equal(C.contractAmountDueCents(234.5, [{ status: "PAID", amountCents: 7_000, refundedCents: 0 }]), 16_450);
  // Μερική επιστροφή: μετρά μόνο το καθαρό.
  assert.equal(C.contractAmountDueCents(100, [{ status: "PARTIALLY_REFUNDED", amountCents: 5_000, refundedCents: 2_000 }]), 7_000);
  // Ανοιχτή / αποτυχημένη / ληγμένη πληρωμή δεν αφαιρείται.
  for (const status of ["OPEN", "FAILED", "EXPIRED"]) {
    assert.equal(C.contractAmountDueCents(100, [{ status, amountCents: 10_000, refundedCents: 0 }]), 10_000, status);
  }
  // Ποτέ αρνητικό, ποτέ από άκυρο σύνολο.
  assert.equal(C.contractAmountDueCents(50, [{ status: "PAID", amountCents: 9_000, refundedCents: 0 }]), 0);
  assert.equal(C.contractAmountDueCents("abc", []), 0);
});

test("ποσό: ο browser δεν στέλνει ποσό — το route δεν διαβάζει σώμα, το Checkout παίρνει το dueCents του server", () => {
  const route = read("src/app/api/contracts/[id]/payment/route.ts");
  assert.doesNotMatch(route, /req\.json\(/, "το POST δεν διαβάζει σώμα");
  const server = read("src/lib/contractPayment.ts");
  assert.match(server, /const amount = ctx\.dueCents;/);
  assert.match(server, /unit_amount: amount/);
  assert.match(server, /dueCents: contractAmountDueCents\(c\.booking\.total, site\)/);
  // Το σύνολο της κράτησης το γράφει ΜΟΝΟ ο server (priceBookingExtras/decidePriceOverride στο PATCH).
  assert.match(read("src/app/api/contracts/[id]/route.ts"), /priceBookingExtras\(tenantId, current\.bookingId, next\)/);
});

test("link: μόνο σε υπογεγραμμένο, με «Κάρτα», ενεργό Stripe και ποσό ≥ 0,50 €", () => {
  const base = { status: "SIGNED", mode: "STRIPE", stripeActive: true, dueCents: 10_000, contractPayments: [] };
  assert.deepEqual(C.checkOpenPayment(base), { ok: true });
  assert.equal(C.checkOpenPayment({ ...base, status: "DRAFT" }).ok, false);
  assert.equal(C.checkOpenPayment({ ...base, status: "COMPLETED" }).ok, false);
  assert.equal(C.checkOpenPayment({ ...base, mode: null }).ok, false);
  assert.equal(C.checkOpenPayment({ ...base, mode: "MANUAL" }).ok, false);
  assert.equal(C.checkOpenPayment({ ...base, stripeActive: false }).ok, false);
  assert.equal(C.checkOpenPayment({ ...base, dueCents: 49 }).ok, false);
  assert.equal(C.checkOpenPayment({ ...base, contractPayments: [{ status: "PAID", amountCents: 10_000, refundedCents: 0 }] }).ok, false);
});

test("link: ανοιχτό link ίδιου ποσού ξαναδίνεται· ληγμένο ή άλλο ποσό → νέο", () => {
  const open = { status: "OPEN", amountCents: 10_000, refundedCents: 0, checkoutUrl: "https://checkout.stripe.com/x", expiresAt: new Date(NOW.getTime() + 3_600_000) };
  assert.equal(C.reusableCheckout([open], 10_000, NOW), open);
  assert.equal(C.reusableCheckout([open], 9_000, NOW), null);
  assert.equal(C.reusableCheckout([{ ...open, expiresAt: new Date(NOW.getTime() - 1) }], 10_000, NOW), null);
  assert.equal(C.contractPayStatus({ ...open, expiresAt: new Date(NOW.getTime() - 1) }, NOW), "EXPIRED");
  assert.equal(C.contractPayStatus(open, NOW), "AWAITING");
  assert.equal(C.contractPayStatus(null, NOW), "NONE");
});

/* ── Ολοκλήρωση μόνο με επιβεβαιωμένη πληρωμή ── */

test("ολοκλήρωση: με Stripe ΜΟΝΟ αφού το webhook/Stripe επιβεβαιώσει την πληρωμή", () => {
  const stripe = { mode: "STRIPE", dueCents: 10_000 };
  assert.equal(C.completionBlock({ ...stripe, contractPayments: [] }), C.CONTRACT_PAY_MSG.completeBlocked);
  // Ανοιχτό link (ο πελάτης «γύρισε» από το Stripe) ΔΕΝ αρκεί.
  assert.equal(C.completionBlock({ ...stripe, contractPayments: [{ status: "OPEN", amountCents: 10_000, refundedCents: 0 }] }), C.CONTRACT_PAY_MSG.completeBlocked);
  assert.equal(C.completionBlock({ ...stripe, contractPayments: [{ status: "FAILED", amountCents: 10_000, refundedCents: 0 }] }), C.CONTRACT_PAY_MSG.completeBlocked);
  assert.equal(C.completionBlock({ ...stripe, contractPayments: [{ status: "PAID", amountCents: 10_000, refundedCents: 0 }] }), null);
  // Τίποτα για πληρωμή (ήδη πληρωμένο online) ή παλιός τρόπος → ολοκληρώνεται όπως πριν.
  assert.equal(C.completionBlock({ ...stripe, dueCents: 0, contractPayments: [] }), null);
  assert.equal(C.completionBlock({ mode: "MANUAL", dueCents: 10_000, contractPayments: [] }), null);
  assert.equal(C.completionBlock({ mode: null, dueCents: 10_000, contractPayments: [] }), null);
});

test("ολοκλήρωση: το route ελέγχει την πληρωμή ΠΡΙΝ γράψει COMPLETED· η σελίδα επιστροφής δεν επιβεβαιώνει τίποτα", () => {
  const src = read("src/app/api/contracts/[id]/complete/route.ts");
  const guard = src.indexOf("completionBlockOf(pay)");
  assert.ok(guard > 0 && guard < src.indexOf('status: "COMPLETED"'), "έλεγχος πριν την εγγραφή");
  assert.match(src, /if \(blocked\) return conflict\(blocked\)/);
  // Το redirect του Stripe πάει σε στατική σελίδα, χωρίς βάση και χωρίς παραμέτρους.
  const page = read("src/app/pay/[result]/page.tsx");
  assert.doesNotMatch(page, /from "@\/lib\/db"|searchParams|session_id/);
  assert.match(read("src/lib/contractPayment.ts"), /success_url: `\$\{base\}\/pay\/done`/);
});

/* ── Κανένα στοιχείο κάρτας στις νέες πληρωμές ── */

test("τρόπος κάρτας: Stripe στα νέα συμβόλαια με ενεργό λογαριασμό· παλιός τρόπος σε παλιά με κάρτα ή χωρίς Stripe", () => {
  const m = (o) => C.contractCardMode({ paymentMethod: "CARD", hasLegacyCard: false, hasContractPayment: false, stripeActive: true, ...o });
  assert.equal(m({}), "STRIPE");
  assert.equal(m({ hasLegacyCard: true }), "MANUAL");
  assert.equal(m({ stripeActive: false }), "MANUAL");
  // Μόλις υπάρξει πληρωμή στο Stripe, μένει Stripe (και αν απενεργοποιηθεί ο λογαριασμός).
  assert.equal(m({ stripeActive: false, hasContractPayment: true }), "STRIPE");
  assert.equal(m({ paymentMethod: "CASH" }), null);
});

test("Stripe: το PATCH και το walk-in αρνούνται στοιχεία κάρτας πληρωμής", () => {
  assert.equal(C.sendsPaymentCardData({ paymentCard: { brand: "VISA", last4: "4242", holder: "", expiry: "12/30" } }), true);
  assert.equal(C.sendsPaymentCardData({ paymentCardNumber: "4242424242424242" }), true);
  assert.equal(C.sendsPaymentCardData({ paymentCard: null }), false);
  assert.equal(C.sendsPaymentCardData({}), false);
  for (const f of ["src/app/api/contracts/[id]/route.ts", "src/app/api/contracts/walk-in/route.ts"]) {
    assert.match(read(f), /=== "STRIPE" && sendsPaymentCardData\(/, f);
  }
});

test("Stripe: η γραμμή πληρωμής δεν έχει πεδία κάρτας — μόνο ποσό, session, κατάσταση", () => {
  const src = read("src/lib/contractPayment.ts");
  const create = src.slice(src.indexOf("db.bookingPayment.create({"), src.indexOf("} catch (e) {", src.indexOf("db.bookingPayment.create({")));
  assert.ok(create.length > 0);
  assert.match(create, /purpose: "CONTRACT"/);
  assert.doesNotMatch(create, /card|last4|brand|expiry|cardNumber/i);
  // Και κανένα στοιχείο κάρτας δεν διαβάζεται από το Stripe.
  assert.doesNotMatch(src, /payment_method_details|\.card\b|last4/);
  // Το schema του booking_payments δεν έχει στήλες κάρτας.
  const model = read("prisma/schema.prisma").match(/model BookingPayment \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(model, /card|last4|brand|expiry/i);
});

test("SQL 29: μόνο η στήλη purpose (BOOKING/CONTRACT), idempotent, με verification", () => {
  const sql = read("prisma/sql/29-contract-payment.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'BOOKING'/);
  assert.match(sql, /CHECK \("purpose" IN \('BOOKING', 'CONTRACT'\)\)/);
  assert.match(sql, /Επαλήθευση \(αναμενόμενο: 1 \| 1 \| 1 \| 0\)/);
  assert.doesNotMatch(sql, /DROP|DELETE|UPDATE "booking_payments"/);
});

/* ── Webhook: ίδια οδός, η κράτηση δεν πειράζεται ── */

function fakeStore() {
  const state = {
    events: new Set(),
    tenants: [
      { id: "T1", account: "acct_1", rentalMode: "BOOKING" },
      { id: "T2", account: "acct_2", rentalMode: "BOOKING" },
    ],
    bookings: [
      // Ενεργή ενοικίαση (το συμβόλαιο υπογράφηκε), ήδη πληρωμένη προκαταβολή στο site.
      { id: "B1", tenantId: "T1", vehicleId: "v1", status: "ACTIVE", paymentStatus: "PAID" },
      { id: "B2", tenantId: "T2", vehicleId: "v9", status: "ACTIVE", paymentStatus: "NONE" },
    ],
    payments: [
      { id: "C1", tenantId: "T1", bookingId: "B1", session: "cs_c1", intent: null, status: "OPEN", amountCents: 16_450, refundedCents: 0, retainedCents: 0, purpose: "CONTRACT" },
      { id: "C2", tenantId: "T2", bookingId: "B2", session: "cs_c2", intent: null, status: "OPEN", amountCents: 5_000, refundedCents: 0, retainedCents: 0, purpose: "CONTRACT" },
    ],
  };
  const store = {
    run: async (fn) => fn({}),
    markEvent: async (_tx, e) => (state.events.has(e.id) ? false : (state.events.add(e.id), true)),
    tenantByAccount: async (_tx, acct) => {
      const t = state.tenants.find((x) => x.account === acct);
      return t ? { id: t.id, rentalMode: t.rentalMode } : null;
    },
    paymentBySession: async (_tx, tenantId, s) => state.payments.find((p) => p.tenantId === tenantId && p.session === s) ?? null,
    paymentByIntent: async (_tx, tenantId, i) => state.payments.find((p) => p.tenantId === tenantId && p.intent === i) ?? null,
    booking: async (_tx, tenantId, id) => state.bookings.find((b) => b.tenantId === tenantId && b.id === id) ?? null,
    applyTransition: async (_tx, b, p, t) => {
      const bk = state.bookings.find((x) => x.id === b.id);
      Object.assign(bk, { paymentStatus: t.booking.paymentStatus }, t.booking.status ? { status: t.booking.status } : {});
      const pm = state.payments.find((x) => x.id === p.id);
      pm.status = t.payment.status;
      if (t.payment.refundedCents !== undefined) pm.refundedCents = t.payment.refundedCents;
      if (t.payment.paymentIntentId) pm.intent = t.payment.paymentIntentId;
    },
    updateAccount: async () => {},
  };
  return { state, store };
}

const cs = (over = {}) => ({
  id: "cs_c1",
  object: "checkout.session",
  payment_status: "paid",
  amount_total: 16_450,
  currency: "eur",
  payment_intent: "pi_c1",
  metadata: { bookingId: "B1", tenantId: "T1", contractId: "K1", purpose: "CONTRACT" },
  ...over,
});
const ev = (id, type, object, account = "acct_1") => ({ id, type, account, data: { object } });

test("webhook: πληρωμή συμβολαίου → PAID στη γραμμή· η κράτηση (κατάσταση, ένδειξη site) μένει ίδια", async () => {
  const { state, store } = fakeStore();
  assert.equal(await handleConnectEvent(ev("e1", "checkout.session.completed", cs()), store), "applied");
  assert.equal(state.payments[0].status, "PAID");
  assert.deepEqual(state.bookings[0], { id: "B1", tenantId: "T1", vehicleId: "v1", status: "ACTIVE", paymentStatus: "PAID" });
  // Λάθος ποσό → όχι PAID.
  const s2 = fakeStore();
  assert.equal(await handleConnectEvent(ev("e2", "checkout.session.completed", cs({ amount_total: 100 })), s2.store), "amount_mismatch");
  assert.equal(s2.state.payments[0].status, "OPEN");
});

test("webhook: αποτυχία/λήξη πληρωμής συμβολαίου δεν ακυρώνει την κράτηση", async () => {
  const { state, store } = fakeStore();
  assert.equal(await handleConnectEvent(ev("e3", "checkout.session.expired", cs({ payment_status: "unpaid" })), store), "applied");
  assert.equal(state.payments[0].status, "EXPIRED");
  assert.equal(state.bookings[0].status, "ACTIVE");
  assert.equal(state.bookings[0].paymentStatus, "PAID");
  const r = P.transitionFor(
    { status: "PENDING", paymentStatus: "AWAITING_PAYMENT", rentalMode: "BOOKING" },
    { status: "OPEN", amountCents: 100, refundedCents: 0, purpose: "CONTRACT" },
    { kind: "failed" }
  );
  assert.equal(r.ok, true);
  assert.equal(r.t.booking.status, undefined, "καμία ακύρωση κράτησης");
});

/* ── Απομόνωση εταιριών ── */

test("απομόνωση: session της Τ1 με metadata της Τ2 (ή στον λογαριασμό της Τ2) → καμία αλλαγή", async () => {
  const { state, store } = fakeStore();
  // Metadata άλλης εταιρίας στον λογαριασμό της Τ1.
  assert.equal(await handleConnectEvent(ev("e4", "checkout.session.completed", cs({ metadata: { bookingId: "B2", tenantId: "T2" } })), store), "mismatch");
  // Η session της Τ1 «παρουσιάζεται» από τον λογαριασμό της Τ2.
  assert.equal(await handleConnectEvent(ev("e5", "checkout.session.completed", cs({ metadata: { bookingId: "B1", tenantId: "T2" } }), "acct_2"), store), "not_found");
  assert.equal(state.payments[0].status, "OPEN");
  assert.equal(state.payments[1].status, "OPEN");
});

test("απομόνωση: κάθε route πληρωμής συμβολαίου περνά από contractScope / tenantId της συνεδρίας", () => {
  const server = read("src/lib/contractPayment.ts");
  assert.match(server, /where: \{ \.\.\.contractScope\(viewer\), id: contractId \}/);
  for (const f of ["src/app/api/contracts/[id]/payment/route.ts", "src/app/api/contracts/[id]/payment/check/route.ts"]) {
    const src = read(f);
    assert.match(src, /withPermission\(/, f);
    assert.match(src, /loadContractPaymentContext\(viewer!, params!\.id\)/, f);
    assert.doesNotMatch(src, /db\.bookingPayment|db\.contract\./, `${f}: καμία ανάγνωση εκτός scope`);
  }
  // Επιστροφή: ίδια ροή, εταιρία από τη συνεδρία, μόνο Διαχειριστής.
  const refund = read("src/app/api/bookings/[id]/refund/route.ts");
  assert.match(refund, /canRefund\(viewer\.role\)/);
  assert.match(refund, /where: \{ tenantId, bookingId: id, purpose: parsed\.data\.scope === "contract" \? "CONTRACT" : "BOOKING"/);
  // Ο εφεδρικός έλεγχος παίρνει session ΜΟΝΟ από τη γραμμή της ίδιας εταιρίας.
  assert.match(server, /tenantId: c\.tenantId,\s*payment: \{ stripeCheckoutSessionId: p\.stripeCheckoutSessionId/);
});

test("επιστροφή: πληρωμή συμβολαίου επιστρέφεται και σε μη ακυρωμένη κράτηση· του site μόνο σε ακυρωμένη", () => {
  const paid = { status: "PAID", amountCents: 10_000, refundedCents: 0 };
  assert.equal(P.checkRefund({ status: "ACTIVE" }, { ...paid, purpose: "CONTRACT" }, 2_000).ok, true);
  assert.equal(P.checkRefund({ status: "ACTIVE" }, { ...paid, purpose: "BOOKING" }, 2_000).ok, false);
  assert.equal(P.checkRefund({ status: "COMPLETED" }, { ...paid, purpose: "CONTRACT" }, 20_000).ok, false, "όχι πάνω από το ποσό");
});

test("οι πληρωμές του site δεν μπερδεύονται με του συμβολαίου (λίστα κρατήσεων, σελίδα πελάτη, αποφάσεις)", () => {
  assert.match(read("src/lib/bookings.ts"), /where: \{ purpose: "BOOKING" \}/);
  assert.match(read("src/lib/public/bookingLookup.ts"), /where: \{ purpose: "BOOKING" \}/);
  assert.match(read("src/lib/bookingDecisionServer.ts"), /purpose: "BOOKING", status: \{ in:/);
  assert.match(read("src/lib/public/paymentServer.ts"), /where: \{ tenantId, bookingId, purpose: "BOOKING" \}/);
});
