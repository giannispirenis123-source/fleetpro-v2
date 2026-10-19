// src/lib/public/paymentWebhook.ts
// Stripe Connect webhook — η ΛΟΓΙΚΗ, με εγχυόμενη βάση (store), ώστε να
// ελέγχεται χωρίς δίκτυο/βάση. Το route ελέγχει την υπογραφή και δίνει εδώ
// το ήδη επαληθευμένο event.
//
// · Idempotent: το event id γράφεται στο stripe_events ΜΕΣΑ στην ίδια
//   transaction με την αλλαγή — το ίδιο event δεν εφαρμόζεται ποτέ δύο φορές
//   (και αν η αλλαγή αποτύχει, δεν γράφεται, άρα το Stripe ξαναδοκιμάζει).
// · Εταιρία ΜΟΝΟ από το event.account (ο συνδεδεμένος λογαριασμός)· κράτηση
//   από τα metadata, ΠΑΝΤΑ με έλεγχο ότι ταιριάζουν (tenantId, bookingId,
//   session). Ό,τι δεν ταιριάζει αγνοείται (200, χωρίς αλλαγή).
// · PAID ΜΟΝΟ από εδώ, και μόνο αν το ποσό/νόμισμα ισούται με το αναμενόμενο.
// · Στα logs: μόνο τύπος event και αποτέλεσμα — ποτέ email, ποσά κάρτας, ονόματα.

import { transitionFor, type BookingPaymentState, type CheckoutEvent, type PaymentRowState, type Transition } from "./payments";

/** Ό,τι διαβάζουμε από ένα event του Stripe (υποσύνολο, χωρίς τύπους της βιβλιοθήκης). */
export interface ConnectEvent {
  id: string;
  type: string;
  account?: string | null;
  data: { object: Record<string, unknown> };
}

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "account.updated",
  "charge.refunded",
] as const;

export interface WebhookPayment extends PaymentRowState {
  id: string;
  tenantId: string;
  bookingId: string;
}

export interface WebhookBooking extends BookingPaymentState {
  id: string;
  tenantId: string;
  vehicleId: string;
}

export interface WebhookStore<Tx> {
  /** Transaction· ό,τι γίνεται μέσα είναι όλα-ή-τίποτα. */
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Γράφει το event· false = υπήρχε ήδη (εφαρμόστηκε παλιότερα). */
  markEvent(tx: Tx, e: { id: string; type: string; account: string | null }): Promise<boolean>;
  tenantByAccount(tx: Tx, accountId: string): Promise<{ id: string; rentalMode: string } | null>;
  paymentBySession(tx: Tx, tenantId: string, sessionId: string): Promise<WebhookPayment | null>;
  paymentByIntent(tx: Tx, tenantId: string, paymentIntentId: string): Promise<WebhookPayment | null>;
  booking(tx: Tx, tenantId: string, bookingId: string): Promise<WebhookBooking | null>;
  applyTransition(tx: Tx, b: WebhookBooking, p: WebhookPayment, t: Transition): Promise<void>;
  updateAccount(
    tx: Tx,
    tenantId: string,
    flags: { stripeChargesEnabled: boolean; stripePayoutsEnabled: boolean; stripeDetailsSubmitted: boolean }
  ): Promise<void>;
}

export type WebhookOutcome =
  | "applied"
  | "duplicate"
  | "ignored_type"
  | "unknown_account"
  | "mismatch"
  | "not_found"
  | "amount_mismatch"
  | "noop"
  | "pending";

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Από το event της Checkout Session στο «τι συνέβη». null = τίποτα ακόμα (π.χ. ασύγχρονη πληρωμή σε εξέλιξη). */
export function checkoutEventOf(type: string, session: Record<string, unknown>): CheckoutEvent | null {
  switch (type) {
    case "checkout.session.completed":
      // Κάρτα: payment_status "paid". Ασύγχρονες μέθοδοι: "unpaid" → περιμένουμε το async_payment_*.
      if (session.payment_status !== "paid") return null;
    // falls through
    case "checkout.session.async_payment_succeeded": {
      const pi = session.payment_intent;
      return {
        kind: "paid",
        amountTotal: num(session.amount_total),
        currency: str(session.currency),
        paymentIntentId: typeof pi === "string" ? pi : str(obj(pi).id),
      };
    }
    case "checkout.session.async_payment_failed":
      return { kind: "failed" };
    case "checkout.session.expired":
      return { kind: "expired" };
    default:
      return null;
  }
}

export async function handleConnectEvent<Tx>(e: ConnectEvent, store: WebhookStore<Tx>): Promise<WebhookOutcome> {
  if (!(HANDLED_EVENTS as readonly string[]).includes(e.type)) return "ignored_type";
  const account = str(e.account);
  if (!account) return "unknown_account";
  const o = e.data.object;

  return store.run(async (tx) => {
    const tenant = await store.tenantByAccount(tx, account);
    if (!tenant) return "unknown_account";
    if (!(await store.markEvent(tx, { id: e.id, type: e.type, account }))) return "duplicate";

    if (e.type === "account.updated") {
      // Το αντικείμενο ΠΡΕΠΕΙ να είναι ο ίδιος ο λογαριασμός του event.
      if (str(o.id) !== account) return "mismatch";
      await store.updateAccount(tx, tenant.id, {
        stripeChargesEnabled: o.charges_enabled === true,
        stripePayoutsEnabled: o.payouts_enabled === true,
        stripeDetailsSubmitted: o.details_submitted === true,
      });
      return "applied";
    }

    if (e.type !== "charge.refunded") return applySession(tx, store, tenant, e.type, o);

    const pi = str(o.payment_intent) ?? str(obj(o.payment_intent).id);
    const refunded = num(o.amount_refunded);
    if (!pi || refunded === null) return "not_found";
    const payment = await store.paymentByIntent(tx, tenant.id, pi);
    const ev: CheckoutEvent = { kind: "refunded", amountRefunded: refunded };
    if (!payment) return "not_found";
    return applyTo(tx, store, tenant, payment, ev);
  });
}

/**
 * Μία Checkout Session (από event ή από retrieve) → αλλαγή. ΙΔΙΟΙ έλεγχοι και
 * για τις δύο οδούς: metadata της ΙΔΙΑΣ εταιρίας, session της ίδιας εταιρίας,
 * ίδια κράτηση, ποσό/νόμισμα, idempotency (η γραμμή πληρωμής κλειδώνεται·
 * δεύτερο «paid» = noop).
 */
async function applySession<Tx>(
  tx: Tx,
  store: WebhookStore<Tx>,
  tenant: { id: string; rentalMode: string },
  type: string,
  o: Record<string, unknown>
): Promise<WebhookOutcome> {
  const sessionId = str(o.id);
  const meta = obj(o.metadata);
  // Τα metadata πρέπει να δείχνουν ΤΗΝ ΙΔΙΑ εταιρία με τον λογαριασμό.
  if (!sessionId || str(meta.tenantId) !== tenant.id || !str(meta.bookingId)) return "mismatch";
  const payment = await store.paymentBySession(tx, tenant.id, sessionId);
  if (payment && payment.bookingId !== meta.bookingId) return "mismatch";
  const ev = checkoutEventOf(type, o);
  if (!ev) return payment ? "pending" : "not_found";
  if (!payment) return "not_found";
  return applyTo(tx, store, tenant, payment, ev);
}

async function applyTo<Tx>(
  tx: Tx,
  store: WebhookStore<Tx>,
  tenant: { id: string; rentalMode: string },
  payment: WebhookPayment,
  ev: CheckoutEvent
): Promise<WebhookOutcome> {
  const booking = await store.booking(tx, tenant.id, payment.bookingId);
  if (!booking) return "not_found";
  const r = transitionFor({ ...booking, rentalMode: tenant.rentalMode }, payment, ev);
  if (!r.ok) return r.reason;
  await store.applyTransition(tx, booking, payment, r.t);
  return "applied";
}

/* ─────────────────────────────────────────────
   Εφεδρικός έλεγχος χωρίς webhook (retrieve της session)
   ───────────────────────────────────────────── */

/**
 * Ρωτά το Stripe για τη session μιας κράτησης και περνά το αποτέλεσμα από την
 * ΙΔΙΑ λογική με το webhook. Η session ΜΟΝΟ από το booking_payments της ΙΔΙΑΣ
 * εταιρίας (ποτέ από URL) και μόνο με τον λογαριασμό που την έφτιαξε.
 * Το webhook μένει η κύρια οδός· όποιο φτάσει δεύτερο βρίσκει PAID → noop.
 */
export async function checkSessionNow<Tx>(
  opts: {
    tenantId: string;
    /** Από το booking_payments: η session και ο λογαριασμός που τη δημιούργησε. */
    payment: { stripeCheckoutSessionId: string; stripeAccountId: string };
    retrieve: (sessionId: string, account: string) => Promise<Record<string, unknown>>;
  },
  store: WebhookStore<Tx>
): Promise<WebhookOutcome> {
  const { payment } = opts;
  const session = await opts.retrieve(payment.stripeCheckoutSessionId, payment.stripeAccountId);
  // Η απάντηση πρέπει να είναι ΑΥΤΗ η session.
  if (str(session.id) !== payment.stripeCheckoutSessionId) return "mismatch";
  let type: string;
  if (session.status === "complete" && session.payment_status === "paid") type = "checkout.session.completed";
  else if (session.status === "expired") type = "checkout.session.expired";
  else return "pending";

  return store.run(async (tx) => {
    // Ο λογαριασμός της session πρέπει να ανήκει ΣΤΗΝ ΙΔΙΑ εταιρία.
    const tenant = await store.tenantByAccount(tx, payment.stripeAccountId);
    if (!tenant || tenant.id !== opts.tenantId) return "unknown_account";
    return applySession(tx, store, tenant, type, session);
  });
}
