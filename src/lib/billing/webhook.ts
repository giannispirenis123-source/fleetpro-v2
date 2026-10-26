// src/lib/billing/webhook.ts
// Stripe Billing webhook (συνδρομές εταιριών) — η ΛΟΓΙΚΗ, με εγχυόμενες
// εξαρτήσεις (βάση + Stripe), ώστε να ελέγχεται χωρίς δίκτυο/βάση. Το route
// ελέγχει την υπογραφή (STRIPE_BILLING_WEBHOOK_SECRET) και δίνει εδώ το ήδη
// επαληθευμένο event. ΞΕΧΩΡΙΣΤΟ από το Connect webhook (πληρωμές κρατήσεων).
//
// · Από το event κρατάμε ΜΟΝΟ ids (πελάτης, συνδρομή, τιμολόγιο) και
//   ξαναδιαβάζουμε το αντικείμενο από το Stripe με τη δική μας έκδοση API:
//   η σειρά των events δεν παίζει ρόλο και η μορφή δεν εξαρτάται από την
//   έκδοση του webhook endpoint.
// · Εταιρία ΜΟΝΟ από τον πελάτη Stripe (tenants.stripeCustomerId, UNIQUE)·
//   στο Checkout ΚΑΙ client_reference_id της ίδιας εταιρίας. Ό,τι δεν
//   ταιριάζει αγνοείται (200, χωρίς αλλαγή).
// · Idempotent: κάθε ενέργεια είναι ίδια όσες φορές κι αν τρέξει (συγχρονισμός
//   κατάστασης, εγγραφή τιμολογίου με PK)· το event id γράφεται στο
//   stripe_events μόνο ΑΦΟΥ πετύχει — σφάλμα = 500 και το Stripe ξαναστέλνει.
// · Logs: μόνο τύπος event και αποτέλεσμα — ποτέ email, ονόματα, ποσά.

import {
  billingNow,
  founderDiscountEnd,
  founderFullCharge,
  founderInvoiceDecision,
  subscriptionPatch,
  type BillingConfig,
  type FounderInvoiceRow,
  type InvoiceSnapshot,
  type SubscriptionSnapshot,
  type TenantBillingPatch,
  type TenantBillingRow,
} from "./core";

export interface BillingEvent {
  id: string;
  type: string;
  account?: string | null;
  data: { object: Record<string, unknown> };
}

export const BILLING_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.created",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
  // Μόνο με ενεργά test clocks (Preview): η νέα ώρα του clock μετά από «Advance».
  "test_helpers.test_clock.ready",
] as const;

export interface BillingTenant extends TenantBillingRow {
  id: string;
  stripeCustomerId: string | null;
  isFounder: boolean;
  stripeTestClockId?: string | null;
  billingClockAt?: Date | null;
}

export interface FounderInvoiceRecord extends FounderInvoiceRow {
  stripeInvoiceId: string;
  periodEnd: Date | null;
}

export interface BillingDeps {
  config: BillingConfig;
  eventSeen(id: string): Promise<boolean>;
  markEvent(id: string, type: string): Promise<void>;
  tenantByCustomer(customerId: string): Promise<BillingTenant | null>;
  retrieveSubscription(subId: string): Promise<SubscriptionSnapshot & { customerId: string | null; tenantIdMeta: string | null }>;
  retrieveInvoice(invoiceId: string): Promise<InvoiceSnapshot & { customerId: string | null; founderCoupon: boolean }>;
  applyPatch(tenantId: string, patch: TenantBillingPatch): Promise<void>;
  founderInvoices(tenantId: string): Promise<FounderInvoiceRecord[]>;
  /** Η έκπτωση 50% στο τιμολόγιο (draft) στο Stripe — idempotent. */
  applyFounderDiscount(invoiceId: string): Promise<void>;
  /** INSERT … ON CONFLICT DO NOTHING. */
  recordFounderInvoice(r: { tenantId: string; stripeInvoiceId: string; months: number; status: "open" | "paid"; periodEnd: Date | null; paidAt: Date | null }): Promise<void>;
  setFounderInvoiceStatus(stripeInvoiceId: string, tenantId: string, status: "paid" | "void", at: Date): Promise<void>;
  setFounderDiscountEnd(tenantId: string, endsAt: Date | null): Promise<void>;
  /** Ένδειξη «πλήρης χρέωση χωρίς έκπτωση» — INSERT … ON CONFLICT DO NOTHING. */
  recordFullCharge(r: { tenantId: string; stripeInvoiceId: string; amountCents: number; billingReason: string | null }): Promise<void>;
  /** Test clocks ενεργά (Preview + sk_test_ + flag) — βλ. core.ts testClocksEnabled. */
  clocksOn: boolean;
  /** Νέα ώρα ενός test clock → στις εταιρίες του. */
  setClockTime(clockId: string, at: Date): Promise<number>;
  now(): Date;
}

export type BillingOutcome =
  | "applied"
  | "duplicate"
  | "ignored_type"
  | "ignored_connect"
  | "ignored_mode"
  | "unknown_customer"
  | "mismatch"
  | "stale_subscription"
  | "full_charge"
  | "noop";

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const idOf = (v: unknown): string | null =>
  str(v) ?? (v && typeof v === "object" ? str((v as Record<string, unknown>).id) : null);

/** Συγχρονισμός μιας συνδρομής στην εταιρία (κοινό για όλα τα events). */
async function syncSubscription(deps: BillingDeps, tenant: BillingTenant, subId: string, now: Date): Promise<BillingOutcome> {
  const sub = await deps.retrieveSubscription(subId);
  if (sub.customerId !== tenant.stripeCustomerId) return "mismatch";
  if (sub.tenantIdMeta && sub.tenantIdMeta !== tenant.id) return "mismatch";
  const patch = subscriptionPatch(tenant, sub, deps.config.prices, now);
  if (!patch) return "stale_subscription";
  await deps.applyPatch(tenant.id, patch);
  return "applied";
}

async function refreshFounderEnd(deps: BillingDeps, tenantId: string): Promise<void> {
  const rows = await deps.founderInvoices(tenantId);
  await deps.setFounderDiscountEnd(tenantId, founderDiscountEnd(rows));
}

export async function handleBillingEvent(e: BillingEvent, deps: BillingDeps): Promise<BillingOutcome> {
  if (!(BILLING_EVENTS as readonly string[]).includes(e.type)) return "ignored_type";
  // Events συνδεδεμένων λογαριασμών (Connect) δεν αφορούν τις συνδρομές.
  if (str(e.account)) return "ignored_connect";
  if (await deps.eventSeen(e.id)) return "duplicate";

  const o = e.data.object;
  if (e.type === "test_helpers.test_clock.ready") {
    // Μόνο με ενεργά clocks· αλλιώς σαν άγνωστο event (καμία αλλαγή).
    if (!deps.clocksOn) return "ignored_type";
    const clockId = str(o.id);
    const frozen = typeof o.frozen_time === "number" ? new Date(o.frozen_time * 1000) : null;
    if (!clockId || !frozen) return "noop";
    const n = await deps.setClockTime(clockId, frozen);
    await deps.markEvent(e.id, e.type);
    return n > 0 ? "applied" : "noop";
  }

  const customerId = idOf(o.customer);
  if (!customerId) return "unknown_customer";
  const tenant = await deps.tenantByCustomer(customerId);
  if (!tenant) return "unknown_customer";
  // Η «ώρα» της εταιρίας: του test clock της (μόνο Preview) ή η πραγματική.
  const now = billingNow(tenant, deps.now(), deps.clocksOn);

  let outcome: BillingOutcome;
  if (e.type === "checkout.session.completed") {
    if (o.mode !== "subscription") return "ignored_mode";
    // Η session πρέπει να είναι της ΙΔΙΑΣ εταιρίας (το client_reference_id το βάζει ο server μας).
    if (str(o.client_reference_id) !== tenant.id) return "mismatch";
    const subId = idOf(o.subscription);
    outcome = subId ? await syncSubscription(deps, tenant, subId, now) : "noop";
  } else if (e.type.startsWith("customer.subscription.")) {
    const subId = idOf(o.id);
    outcome = subId ? await syncSubscription(deps, tenant, subId, now) : "noop";
  } else {
    outcome = await handleInvoice(e.type, idOf(o.id), tenant, deps, now);
  }

  await deps.markEvent(e.id, e.type);
  return outcome;
}

async function handleInvoice(
  type: string,
  invoiceId: string | null,
  tenant: BillingTenant,
  deps: BillingDeps,
  now: Date
): Promise<BillingOutcome> {
  if (!invoiceId) return "noop";
  const inv = await deps.retrieveInvoice(invoiceId);
  if (inv.customerId !== tenant.stripeCustomerId) return "mismatch";
  let outcome: BillingOutcome = "noop";

  if (type === "invoice.created") {
    const rows = await deps.founderInvoices(tenant.id);
    const already = rows.some((r) => r.stripeInvoiceId === inv.id);
    const d = founderInvoiceDecision(inv, tenant.isFounder, rows, deps.config.prices, already);
    if (d.apply) {
      await deps.applyFounderDiscount(inv.id);
      await deps.recordFounderInvoice({
        tenantId: tenant.id,
        stripeInvoiceId: inv.id,
        months: d.months,
        status: "open",
        periodEnd: inv.periodEnd ? new Date(inv.periodEnd * 1000) : null,
        paidAt: null,
      });
      await refreshFounderEnd(deps, tenant.id);
      outcome = "applied";
    }
    return outcome;
  }

  if (type === "invoice.paid") {
    const rows = await deps.founderInvoices(tenant.id);
    const row = rows.find((r) => r.stripeInvoiceId === inv.id);
    if (row) {
      await deps.setFounderInvoiceStatus(inv.id, tenant.id, "paid", now);
      outcome = "applied";
    } else if (inv.founderCoupon && tenant.isFounder) {
      // Πρώτο τιμολόγιο από Checkout «πληρωμή τώρα» (η έκπτωση μπήκε στο Checkout).
      const price = inv.priceId ? deps.config.prices[inv.priceId] : undefined;
      if (price) {
        await deps.recordFounderInvoice({
          tenantId: tenant.id,
          stripeInvoiceId: inv.id,
          months: price.interval === "year" ? 12 : 1,
          status: "paid",
          periodEnd: inv.periodEnd ? new Date(inv.periodEnd * 1000) : null,
          paidAt: now,
        });
        outcome = "applied";
      }
    }
    if (outcome === "applied") await refreshFounderEnd(deps, tenant.id);
    // Ιδρυτής πλήρωσε ΧΩΡΙΣ έκπτωση ενώ απέμεναν μήνες → ένδειξη για τον Super Admin.
    if (outcome !== "applied" && founderFullCharge(inv, tenant.isFounder, rows, Boolean(row))) {
      await deps.recordFullCharge({
        tenantId: tenant.id,
        stripeInvoiceId: inv.id,
        amountCents: inv.amountPaid ?? inv.amountDue,
        billingReason: inv.billingReason,
      });
      console.warn(`[FleetPro] Billing: ιδρυτής χρεώθηκε ΧΩΡΙΣ έκπτωση tenant=${tenant.id} invoice=${inv.id}`);
      outcome = "full_charge";
    }
  } else if (type === "invoice.voided" || type === "invoice.marked_uncollectible") {
    const rows = await deps.founderInvoices(tenant.id);
    if (rows.some((r) => r.stripeInvoiceId === inv.id)) {
      await deps.setFounderInvoiceStatus(inv.id, tenant.id, "void", now);
      await refreshFounderEnd(deps, tenant.id);
      outcome = "applied";
    }
  }

  // Πληρωμή ή αποτυχία → η κατάσταση της συνδρομής (active / past_due).
  if ((type === "invoice.paid" || type === "invoice.payment_failed") && inv.subscriptionId) {
    const s = await syncSubscription(deps, tenant, inv.subscriptionId, now);
    if (s === "applied" && outcome !== "full_charge") outcome = "applied";
  }
  return outcome;
}
