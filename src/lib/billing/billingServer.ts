// src/lib/billing/billingServer.ts
// Συνδρομές εταιριών με το Stripe Billing — ΜΟΝΟ server. ΞΕΧΩΡΙΣΤΟ από το
// Stripe Connect (πληρωμές πελατών των εταιριών), που δεν αλλάζει σε τίποτα.
//
// Env (Vercel, ΜΟΝΟ Preview σε αυτή τη φάση — ονόματα στο core.ts):
//   STRIPE_SECRET_KEY (ΚΟΙΝΟ με το Connect, ΠΡΕΠΕΙ να είναι sk_test_)
//   STRIPE_BILLING_WEBHOOK_SECRET, STRIPE_BILLING_PRICE_{STARTER|PRO|BUSINESS}_{MONTHLY|YEARLY}
// Αν λείπει κάτι ή το κλειδί είναι live: το Billing είναι ΚΛΕΙΣΤΟ (καμία
// χρέωση· οι νέες εγγραφές μένουν όπως πριν, εκτός χρέωσης).

import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { stripe, stripeErrorCode } from "../stripeConnect";
import { checkWithinLimit } from "../entitlements";
import {
  BILLING_PLAN_KEYS,
  SUBSCRIPTION_PLAN_OF,
  billingAccess,
  canStartCheckout,
  checkoutPlan,
  founderMonthsLeft,
  founderMonthsPaid,
  founderTrialEnd,
  isBillingInterval,
  isBillingPlanKey,
  priceEnvName,
  readBillingConfig,
  subscriptionPatch,
  type BillingAccess,
  type BillingConfig,
  type BillingInterval,
  type BillingPlanKey,
  type InvoiceSnapshot,
  type SubscriptionSnapshot,
  type TenantBillingPatch,
} from "./core";
import type { BillingDeps, BillingTenant } from "./webhook";

/** Coupon ιδρυτή: 50%, ΜΙΑ φορά ανά τιμολόγιο. Φτιάχνεται μόνο του στο test mode αν λείπει. */
export const FOUNDER_COUPON_ID = "fleetpro-founder-50";

let warned = false;
export function billingConfig(): BillingConfig {
  const c = readBillingConfig(process.env);
  if (!c.ready && !warned) {
    warned = true;
    console.warn(`[FleetPro] Stripe Billing: κλειστό — λείπει/λάθος ${c.problems.join(", ")}`);
  }
  return c;
}

export const billingReady = (): boolean => billingConfig().ready;

export class BillingError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = "billing") {
    super(message);
    this.name = "BillingError";
    this.status = status;
    this.code = code;
  }
}

/* ── Stripe → απλά αντικείμενα ── */

export function subscriptionSnapshot(sub: Stripe.Subscription): SubscriptionSnapshot & { customerId: string | null; tenantIdMeta: string | null } {
  const item = sub.items?.data?.[0];
  return {
    id: sub.id,
    status: sub.status,
    priceId: item?.price?.id ?? null,
    trialEnd: sub.trial_end ?? null,
    currentPeriodEnd: sub.current_period_end ?? null,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    tenantIdMeta: sub.metadata?.tenantId ?? null,
  };
}

export function invoiceSnapshot(inv: Stripe.Invoice): InvoiceSnapshot & { customerId: string | null; founderCoupon: boolean } {
  const line = inv.lines?.data?.find((l) => l.type === "subscription") ?? inv.lines?.data?.[0];
  const discounts = (inv.discounts ?? []).filter((d): d is Stripe.Discount => typeof d === "object" && d !== null);
  const coupons = [inv.discount?.coupon?.id, ...discounts.map((d) => d.coupon?.id)].filter(Boolean);
  return {
    id: inv.id,
    status: inv.status ?? "draft",
    billingReason: inv.billing_reason ?? null,
    subscriptionId: typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id ?? null,
    amountDue: inv.amount_due ?? 0,
    priceId: line?.price?.id ?? null,
    periodEnd: line?.period?.end ?? null,
    hasDiscount: coupons.length > 0 || (inv.discounts?.length ?? 0) > 0,
    customerId: typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null,
    founderCoupon: coupons.includes(FOUNDER_COUPON_ID),
  };
}

/** Coupon ιδρυτή: retrieve, αλλιώς create (σταθερό id → δεν διπλασιάζεται). */
export async function ensureFounderCoupon(): Promise<string> {
  try {
    await stripe().coupons.retrieve(FOUNDER_COUPON_ID);
  } catch (e) {
    if ((e as { code?: string }).code !== "resource_missing") throw e;
    await stripe().coupons.create(
      { id: FOUNDER_COUPON_ID, percent_off: 50, duration: "once", name: "Founding company −50%" },
      { idempotencyKey: `coupon-${FOUNDER_COUPON_ID}` }
    );
  }
  return FOUNDER_COUPON_ID;
}

/* ── Εταιρία ── */

const TENANT_BILLING_SELECT = {
  id: true,
  name: true,
  email: true,
  status: true,
  planKey: true,
  billingStatus: true,
  billingInterval: true,
  trialEndsAt: true,
  trialStartedAt: true,
  pastDueSince: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  stripeCustomerId: true,
  stripeSubId: true,
  founderDiscountEndsAt: true,
  founderClaim: { select: { slotNumber: true } },
} as const;

/** Οι αλλαγές συνδρομής στην εταιρία. Το παλιό enum "plan" ακολουθεί το πλάνο. */
export async function applyBillingPatch(tenantId: string, patch: TenantBillingPatch): Promise<void> {
  await db.tenant.update({ where: { id: tenantId }, data: patch });
}

/** Συγχρονισμός από το Stripe (εφεδρικός, μετά το Checkout ή με κουμπί) — ίδια λογική με το webhook. */
export async function syncTenantFromStripe(tenantId: string): Promise<boolean> {
  const config = billingConfig();
  if (!config.ready) return false;
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: TENANT_BILLING_SELECT });
  if (!t?.stripeCustomerId) return false;
  let sub: Stripe.Subscription | undefined;
  if (t.stripeSubId) {
    sub = await stripe().subscriptions.retrieve(t.stripeSubId);
  }
  // Νέα συνδρομή (π.χ. μετά από ακύρωση) — η πιο πρόσφατη του ΙΔΙΟΥ πελάτη.
  if (!sub || ["canceled", "incomplete_expired"].includes(sub.status)) {
    const list = await stripe().subscriptions.list({ customer: t.stripeCustomerId, status: "all", limit: 1 });
    if (list.data[0]) sub = list.data[0];
  }
  if (!sub) return false;
  const snap = subscriptionSnapshot(sub);
  if (snap.customerId !== t.stripeCustomerId) return false;
  if (snap.tenantIdMeta && snap.tenantIdMeta !== t.id) return false;
  const patch = subscriptionPatch(t, snap, config.prices);
  if (!patch) return false;
  await applyBillingPatch(t.id, patch);
  return true;
}

/** Πελάτης Stripe της εταιρίας (ένας· idempotency key ανά εταιρία). */
async function ensureCustomer(t: { id: string; name: string; email: string; stripeCustomerId: string | null }): Promise<string> {
  if (t.stripeCustomerId) return t.stripeCustomerId;
  const c = await stripe().customers.create(
    { email: t.email, name: t.name, metadata: { tenantId: t.id } },
    { idempotencyKey: `billing-customer-${t.id}` }
  );
  // Μόνο αν δεν γράφτηκε ήδη από ταυτόχρονο αίτημα.
  await db.tenant.updateMany({ where: { id: t.id, stripeCustomerId: null }, data: { stripeCustomerId: c.id } });
  const fresh = await db.tenant.findUnique({ where: { id: t.id }, select: { stripeCustomerId: true } });
  return fresh?.stripeCustomerId ?? c.id;
}

const priceIdFor = (config: BillingConfig, plan: BillingPlanKey, interval: BillingInterval): string | null =>
  Object.entries(config.prices).find(([, v]) => v.plan === plan && v.interval === interval)?.[0] ?? null;

/** Stripe Checkout για συνδρομή. Επιστρέφει το URL του Stripe. */
export async function startCheckout(
  tenantId: string,
  plan: unknown,
  interval: unknown,
  origin: string,
  lang: "el" | "en",
  now = new Date()
): Promise<string> {
  const config = billingConfig();
  if (!config.ready) throw new BillingError(503, "Οι συνδρομές δεν είναι διαθέσιμες αυτή τη στιγμή.", "not_configured");
  if (!isBillingPlanKey(plan) || !isBillingInterval(interval)) throw new BillingError(400, "Άγνωστο πλάνο.");
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: TENANT_BILLING_SELECT });
  if (!t) throw new BillingError(404, "Δεν βρέθηκε");
  if (!canStartCheckout(t.billingStatus)) {
    throw new BillingError(409, "Υπάρχει ήδη συνδρομή. Αλλαγές πλάνου/κάρτας από το «Διαχείριση συνδρομής».", "has_subscription");
  }
  const planRow = await db.plan.findUnique({ where: { key: plan }, select: { active: true, priceMonthlyCents: true } });
  if (!planRow?.active || planRow.priceMonthlyCents === null) throw new BillingError(400, "Άγνωστο πλάνο.");
  const priceId = priceIdFor(config, plan, interval);
  if (!priceId) throw new BillingError(503, `Λείπει ${priceEnvName(plan, interval)}.`, "not_configured");

  const rows = t.founderClaim ? await db.founderInvoice.findMany({ where: { tenantId }, select: { months: true, status: true } }) : [];
  const how = checkoutPlan(t, Boolean(t.founderClaim), founderMonthsLeft(rows), now);
  const customer = await ensureCustomer(t);

  const subscription_data: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
    metadata: { tenantId: t.id },
  };
  if (how.kind === "card_trial") subscription_data.trial_period_days = how.trialDays;
  if (how.kind === "trial_until") subscription_data.trial_end = Math.floor(how.trialEnd.getTime() / 1000);
  const discounts = how.kind === "pay_now" && how.founderCoupon ? [{ coupon: await ensureFounderCoupon() }] : undefined;

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: t.id,
    line_items: [{ price: priceId, quantity: 1 }],
    payment_method_types: ["card"],
    subscription_data,
    ...(discounts ? { discounts } : {}),
    metadata: { tenantId: t.id },
    locale: lang,
    success_url: `${origin}/dashboard/billing?checkout=success`,
    cancel_url: `${origin}/dashboard/billing?checkout=cancel`,
  });
  if (!session.url) throw new BillingError(502, "Το Stripe δεν απάντησε. Δοκιμάστε ξανά.");
  return session.url;
}

/** Πύλη πελάτη του Stripe: αλλαγή πλάνου, κάρτας, ακύρωση. */
export async function openPortal(tenantId: string, origin: string): Promise<string> {
  if (!billingReady()) throw new BillingError(503, "Οι συνδρομές δεν είναι διαθέσιμες αυτή τη στιγμή.", "not_configured");
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { stripeCustomerId: true } });
  if (!t?.stripeCustomerId) throw new BillingError(409, "Δεν υπάρχει ακόμα συνδρομή.", "no_customer");
  const s = await stripe().billingPortal.sessions.create({ customer: t.stripeCustomerId, return_url: `${origin}/dashboard/billing` });
  return s.url;
}

/**
 * Αλλαγή πλάνου ΠΡΙΝ από το Stripe (δοκιμή ιδρυτή / αναμονή Checkout). Με
 * ζωντανή συνδρομή η αλλαγή γίνεται ΜΟΝΟ στην Πύλη (για να συμφωνεί η χρέωση).
 */
export async function changePlanBeforeCheckout(tenantId: string, plan: unknown, interval: unknown): Promise<void> {
  if (!isBillingPlanKey(plan) || !isBillingInterval(interval)) throw new BillingError(400, "Άγνωστο πλάνο.");
  const planRow = await db.plan.findUnique({ where: { key: plan }, select: { active: true, priceMonthlyCents: true } });
  if (!planRow?.active || planRow.priceMonthlyCents === null) throw new BillingError(400, "Άγνωστο πλάνο.");
  const r = await db.tenant.updateMany({
    where: { id: tenantId, billingStatus: { in: ["founder_trial", "awaiting_checkout"] } },
    data: { planKey: plan, plan: SUBSCRIPTION_PLAN_OF[plan], billingInterval: interval },
  });
  if (r.count !== 1) throw new BillingError(409, "Η αλλαγή πλάνου γίνεται από το «Διαχείριση συνδρομής».", "has_subscription");
}

/**
 * Δοκιμή ιδρυτή: το ρολόι (30 ημέρες) ξεκινά με το ΠΡΩΤΟ όχημα. Ατομικό:
 * μόνο αν δεν έχει ξεκινήσει ήδη. Καλείται μετά από επιτυχή δημιουργία οχήματος.
 */
export async function startFounderClockIfNeeded(tenantId: string, now = new Date()): Promise<void> {
  await db.tenant.updateMany({
    where: { id: tenantId, billingStatus: "founder_trial", trialStartedAt: null },
    data: { trialStartedAt: now, trialEndsAt: founderTrialEnd(now) },
  });
}

/* ── Σελίδα «Συνδρομή» ── */

export interface BillingPlanDTO {
  key: BillingPlanKey;
  name: string;
  maxVehicles: number | null;
  multiStore: boolean;
  priceMonthlyCents: number;
  priceYearlyCents: number;
}

export interface BillingOverview {
  ready: boolean;
  billingStatus: string;
  interval: BillingInterval;
  planKey: string | null;
  access: { mode: BillingAccess["mode"]; reason: string | null; warning: string | null; until: string | null };
  trialEndsAt: string | null;
  trialStarted: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  canCheckout: boolean;
  canPortal: boolean;
  canChangePlan: boolean;
  plans: BillingPlanDTO[];
  vehicles: { used: number; limit: number | null };
  founder: null | { slot: number; monthsPaid: number; monthsLeft: number; discountEndsAt: string | null };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function billingOverview(tenantId: string, now = new Date()): Promise<BillingOverview | null> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: TENANT_BILLING_SELECT });
  if (!t) return null;
  const [planRows, limit, founderRows] = await Promise.all([
    db.plan.findMany({
      where: { key: { in: [...BILLING_PLAN_KEYS] }, active: true, priceMonthlyCents: { not: null } },
      orderBy: { sortOrder: "asc" },
      select: { key: true, name: true, limits: true, modules: true, priceMonthlyCents: true, priceYearlyCents: true },
    }),
    checkWithinLimit(tenantId, "vehicles"),
    t.founderClaim
      ? db.founderInvoice.findMany({ where: { tenantId }, select: { months: true, status: true } })
      : Promise.resolve([]),
  ]);
  const vehiclesUsed = await db.vehicle.count({ where: { tenantId, isActive: true } });
  const access = billingAccess(t, now);
  const ready = billingReady();
  const plans: BillingPlanDTO[] = planRows.filter((p) => isBillingPlanKey(p.key)).map((p) => {
    const limits = (p.limits ?? {}) as Record<string, unknown>;
    const modules = (p.modules ?? {}) as Record<string, unknown>;
    const max = limits.maxVehicles;
    return {
      key: p.key as BillingPlanKey,
      name: p.name,
      maxVehicles: typeof max === "number" ? max : null,
      multiStore: modules.multiStore === true,
      priceMonthlyCents: p.priceMonthlyCents ?? 0,
      priceYearlyCents: p.priceYearlyCents ?? (p.priceMonthlyCents ?? 0) * 10,
    };
  });
  return {
    ready,
    billingStatus: t.billingStatus,
    interval: isBillingInterval(t.billingInterval) ? t.billingInterval : "month",
    planKey: t.planKey,
    access: {
      mode: access.mode,
      reason: access.mode === "read_only" ? access.reason : null,
      warning: access.mode === "full" ? access.warning ?? null : null,
      until: access.mode === "full" ? iso(access.until ?? null) : null,
    },
    trialEndsAt: iso(t.trialEndsAt),
    trialStarted: Boolean(t.trialStartedAt),
    currentPeriodEnd: iso(t.currentPeriodEnd),
    cancelAtPeriodEnd: t.cancelAtPeriodEnd,
    hasCustomer: Boolean(t.stripeCustomerId),
    canCheckout: ready && canStartCheckout(t.billingStatus),
    canPortal: ready && Boolean(t.stripeCustomerId) && t.billingStatus !== "exempt",
    canChangePlan: ["founder_trial", "awaiting_checkout"].includes(t.billingStatus),
    plans,
    vehicles: { used: vehiclesUsed, limit: limit.limit },
    founder: t.founderClaim
      ? {
          slot: t.founderClaim.slotNumber,
          monthsPaid: founderMonthsPaid(founderRows),
          monthsLeft: founderMonthsLeft(founderRows),
          discountEndsAt: iso(t.founderDiscountEndsAt),
        }
      : null,
  };
}

/* ── Webhook: οι πραγματικές εξαρτήσεις ── */

export function prismaBillingDeps(): BillingDeps {
  const config = billingConfig();
  return {
    config,
    now: () => new Date(),
    async eventSeen(id) {
      return Boolean(await db.stripeEvent.findUnique({ where: { id }, select: { id: true } }));
    },
    async markEvent(id, type) {
      await db.stripeEvent.createMany({ data: [{ id, type, account: null }], skipDuplicates: true });
    },
    async tenantByCustomer(customerId): Promise<BillingTenant | null> {
      const t = await db.tenant.findUnique({ where: { stripeCustomerId: customerId }, select: TENANT_BILLING_SELECT });
      return t ? { ...t, isFounder: Boolean(t.founderClaim) } : null;
    },
    async retrieveSubscription(subId) {
      return subscriptionSnapshot(await stripe().subscriptions.retrieve(subId));
    },
    async retrieveInvoice(invoiceId) {
      return invoiceSnapshot(await stripe().invoices.retrieve(invoiceId, { expand: ["discounts"] }));
    },
    applyPatch: applyBillingPatch,
    async founderInvoices(tenantId) {
      return db.founderInvoice.findMany({
        where: { tenantId },
        select: { stripeInvoiceId: true, months: true, status: true, periodEnd: true },
      });
    },
    async applyFounderDiscount(invoiceId) {
      const coupon = await ensureFounderCoupon();
      await stripe().invoices.update(invoiceId, { discounts: [{ coupon }] }, { idempotencyKey: `founder-discount-${invoiceId}` });
    },
    async recordFounderInvoice(r) {
      await db.founderInvoice.createMany({ data: [r], skipDuplicates: true });
    },
    async setFounderInvoiceStatus(stripeInvoiceId, tenantId, status, at) {
      await db.founderInvoice.updateMany({
        where: { stripeInvoiceId, tenantId },
        data: status === "paid" ? { status, paidAt: at } : { status },
      });
    },
    async setFounderDiscountEnd(tenantId, endsAt) {
      await db.tenant.update({ where: { id: tenantId }, data: { founderDiscountEndsAt: endsAt } });
    },
  };
}

/** Για τα logs: μόνο κωδικός σφάλματος (ποτέ μήνυμα του Stripe ή της βάσης). */
export function billingErrorCode(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return `prisma:${e.code}`;
  return stripeErrorCode(e);
}
