// src/lib/billing/core.ts
// Συνδρομές εταιριών (Stripe Billing) — ΚΑΘΑΡΗ λογική (imports μόνο τα καθαρά
// money.ts / outgoingAmounts.ts), ώστε να τη φορτώνουν server, client components και τα unit tests.
//
// · Ποιος πληρώνει: ΜΟΝΟ εταιρίες με billingStatus ≠ 'exempt'. Οι υπάρχουσες
//   (και όσες φτιάχνει ο Super Admin) είναι 'exempt' → τίποτα δεν αλλάζει.
// · Μόνο ανάγνωση (billingAccess): λήξη δοκιμής ιδρυτή χωρίς κάρτα, εγγραφή
//   χωρίς ολοκληρωμένο Checkout, 7 ημέρες απλήρωτη, ακυρωμένη συνδρομή.
//   Βλέπει τα δεδομένα της, δεν φτιάχνει τίποτα νέο· οι υπάρχουσες κρατήσεις
//   εξυπηρετούνται κανονικά (readOnlyAllows).
// · Οι τιμές/όρια ζουν στη βάση (πίνακας plans)· εδώ μόνο κανόνες.

import { formatMoney } from "../public/money";
import { verifyOutgoingAmounts, type AmountCheck } from "../public/outgoingAmounts";

export const BILLING_PLAN_KEYS = ["starter", "pro", "business"] as const;
export type BillingPlanKey = (typeof BILLING_PLAN_KEYS)[number];
export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const isBillingPlanKey = (v: unknown): v is BillingPlanKey =>
  typeof v === "string" && (BILLING_PLAN_KEYS as readonly string[]).includes(v);
export const isBillingInterval = (v: unknown): v is BillingInterval => v === "month" || v === "year";

/** Το παλιό enum tenants.plan (μόνο εμφάνιση/MRR): ENTERPRISE = Business. */
export const SUBSCRIPTION_PLAN_OF: Record<BillingPlanKey, "STARTER" | "PRO" | "ENTERPRISE"> = {
  starter: "STARTER",
  pro: "PRO",
  business: "ENTERPRISE",
};

/** Πλάνο νέας εταιρίας από /signup (αλλάζει στη «Συνδρομή» πριν από την πληρωμή). */
export const DEFAULT_BILLING_PLAN: BillingPlanKey = "starter";

export const FOUNDER_TRIAL_DAYS = 30;
export const CARD_TRIAL_DAYS = 14;
/** Απλήρωτη: μετά από τόσες ημέρες → μόνο ανάγνωση (το Stripe ξαναδοκιμάζει στο μεταξύ). */
export const UNPAID_GRACE_DAYS = 7;
export const FOUNDER_DISCOUNT_PERCENT = 50;
export const FOUNDER_DISCOUNT_MONTHS = 12;
/** Ειδοποίηση πριν η τιμή γυρίσει στην κανονική. */
export const FOUNDER_NOTICE_DAYS = 30;

const DAY = 86_400_000;

export const BILLING_STATUSES = [
  "exempt",
  "founder_trial",
  "awaiting_checkout",
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];
export const isBillingStatus = (v: unknown): v is BillingStatus =>
  typeof v === "string" && (BILLING_STATUSES as readonly string[]).includes(v);

/** Ό,τι χρειάζεται για την απόφαση πρόσβασης (υποσύνολο του tenant). */
export interface BillingState {
  billingStatus: string;
  trialEndsAt: Date | null;
  pastDueSince: Date | null;
}

export type ReadOnlyReason = "trial_ended" | "checkout_required" | "unpaid" | "canceled";

export type BillingAccess =
  | { mode: "full"; warning?: "trial" | "past_due"; until?: Date | null }
  | { mode: "read_only"; reason: ReadOnlyReason };

/**
 * Πλήρης πρόσβαση ή μόνο ανάγνωση — ΜΙΑ απόφαση για API, σελίδες και banner.
 * Άγνωστη τιμή στη βάση → πλήρης (ασφαλής για τον πελάτη· ο CHECK δεν την αφήνει).
 */
export function billingAccess(t: BillingState, now = new Date()): BillingAccess {
  switch (t.billingStatus) {
    case "founder_trial":
      // Το ρολόι ξεκινά με το πρώτο όχημα: χωρίς trialEndsAt δεν μετρά ακόμα.
      if (!t.trialEndsAt) return { mode: "full" };
      if (now.getTime() < t.trialEndsAt.getTime()) return { mode: "full", warning: "trial", until: t.trialEndsAt };
      return { mode: "read_only", reason: "trial_ended" };
    case "awaiting_checkout":
    case "incomplete":
      return { mode: "read_only", reason: "checkout_required" };
    case "trialing":
      return { mode: "full", warning: "trial", until: t.trialEndsAt };
    case "past_due":
    case "unpaid": {
      const since = t.pastDueSince ?? now;
      const graceEnd = new Date(since.getTime() + UNPAID_GRACE_DAYS * DAY);
      if (now.getTime() < graceEnd.getTime()) return { mode: "full", warning: "past_due", until: graceEnd };
      return { mode: "read_only", reason: "unpaid" };
    }
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return { mode: "read_only", reason: "canceled" };
    default:
      // exempt, active
      return { mode: "full" };
  }
}

export const isReadOnly = (t: BillingState, now = new Date()) => billingAccess(t, now).mode === "read_only";

/* ── Νέα δημόσια κράτηση (site) ανάλογα με τη συνδρομή ── */

/**
 * · "open": όπως πάντα (ενεργή, δοκιμή, εκτός χρέωσης).
 * · "pickup_only": «Απλήρωτη» (past_due/unpaid — μέσα στη χάρη των 7 ημερών ή
 *   μετά): δεκτή ως PENDING, ΜΟΝΟ πληρωμή στην παραλαβή (κανένα Stripe Checkout).
 * · "closed": ακυρωμένη, ληγμένη δοκιμή, αναμονή κάρτας → 409 (όπως πριν).
 * ΜΙΑ απόφαση, πάνω στο billingAccess (ίδια κατάσταση, ίδια ώρα = billingNow).
 */
export type PublicBookingPolicy = "open" | "pickup_only" | "closed";

export function publicBookingPolicy(t: BillingState, now = new Date()): PublicBookingPolicy {
  if (t.billingStatus === "past_due" || t.billingStatus === "unpaid") return "pickup_only";
  return billingAccess(t, now).mode === "read_only" ? "closed" : "open";
}

/** Οι επιλογές πληρωμής του site με βάση την απόφαση: «Απλήρωτη» → μόνο στην παραλαβή. */
export const sitePaymentOptionsFor = <T extends string>(options: T, policy: PublicBookingPolicy): T | "PICKUP_ONLY" =>
  policy === "pickup_only" ? "PICKUP_ONLY" : options;

/** Ολόκληρες ημέρες που απομένουν (στρογγυλά προς τα πάνω, ποτέ αρνητικές). */
export const daysLeft = (until: Date | null | undefined, now = new Date()): number | null =>
  until ? Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY)) : null;

/** Καταστάσεις «σε δοκιμή»: δοκιμή του Stripe ή ιδρυτής χωρίς πληρωμένη συνδρομή ακόμα. */
export const TRIAL_STATUSES = ["trialing", "founder_trial"] as const;

/**
 * Ένδειξη «Νημ.» / «Έληξε» στη λίστα εταιριών του Super Admin: ημέρες μέχρι το
 * trialEndsAt (0 = έληξε), ΜΟΝΟ όσο η εταιρία είναι σε δοκιμή. null = καμία
 * ένδειξη (ενεργή, απλήρωτη, ακυρωμένη, εκτός χρέωσης, δοκιμή που δεν ξεκίνησε).
 * `now` = billingNow (ώρα του test clock όπου υπάρχει).
 */
export function trialDaysLeft(t: { billingStatus: string; trialEndsAt: Date | null }, now: Date): number | null {
  if (!(TRIAL_STATUSES as readonly string[]).includes(t.billingStatus)) return null;
  return daysLeft(t.trialEndsAt, now);
}

/* ── Test clocks (ΜΟΝΟ Preview) ── */

/**
 * Test clocks του Stripe: ΜΟΝΟ όταν ισχύουν ΚΑΙ τα τρία — STRIPE_BILLING_TEST_CLOCKS=1,
 * κλειδί sk_test_ ΚΑΙ VERCEL_ENV === "preview". Σε κάθε άλλη περίπτωση (live
 * κλειδί, Production, τοπικά, flag κλειστό) αγνοείται εντελώς.
 */
export function testClocksEnabled(env: Record<string, string | undefined>): boolean {
  const flag = (env.STRIPE_BILLING_TEST_CLOCKS ?? "").trim().toLowerCase();
  if (flag !== "1" && flag !== "true") return false;
  if (!(env.STRIPE_SECRET_KEY ?? "").trim().startsWith("sk_test_")) return false;
  return (env.VERCEL_ENV ?? "").trim() === "preview";
}

/**
 * Η «ώρα» για τους ελέγχους συνδρομής μιας εταιρίας: η ώρα του test clock της
 * (billingClockAt) όταν τα clocks είναι ενεργά και η εταιρία έχει clock· αλλιώς
 * η πραγματική. Έτσι λήξη δοκιμής, χάρη 7 ημερών και ειδοποίηση 30 ημερών
 * μετακινούνται μαζί με το clock στο Stripe Dashboard.
 */
export function billingNow(
  t: { stripeTestClockId?: string | null; billingClockAt?: Date | null },
  realNow: Date,
  clocksOn: boolean
): Date {
  return clocksOn && t.stripeTestClockId && t.billingClockAt ? t.billingClockAt : realNow;
}

/* ── Μόνο ανάγνωση: τι επιτρέπεται ακόμα ── */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Εγγραφές που επιτρέπονται σε «μόνο ανάγνωση». Όλα τα άλλα POST/PATCH/PUT/
 * DELETE απορρίπτονται στον φύλακα (withAuth) — ποτέ μόνο στο UI.
 *
 * · Συνδρομή, γνώμη, γλώσσα/κωδικός του ίδιου: για να βγει από την κατάσταση.
 * · ΥΠΑΡΧΟΥΣΕΣ κρατήσεις (με id) και τα συμβόλαιά τους: η παραλαβή/επιστροφή
 *   μιας ήδη επιβεβαιωμένης κράτησης γίνεται κανονικά. Νέα κράτηση (POST
 *   /api/bookings), walk-in, όχημα, πελάτης, χρήστης, ρυθμίσεις: όχι.
 * · Προεπισκόπηση τιμής (δεν γράφει τίποτα).
 */
const READ_ONLY_ALLOWED: RegExp[] = [
  /^\/api\/billing(\/|$)/,
  /^\/api\/feedback$/,
  /^\/api\/auth\//,
  /^\/api\/users\/me\//,
  /^\/api\/bookings\/preview$/,
  /^\/api\/bookings\/[^/]+(\/(decision|messages|payment-check|refund|retain))?$/,
  /^\/api\/contracts$/,
  /^\/api\/contracts\/(?!walk-in(\/|$))[^/]+(\/.*)?$/,
];

export function readOnlyAllows(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  if (SAFE_METHODS.has(m)) return true;
  // Διαγραφή: μόνο φωτογραφίες συμβολαίου (διόρθωση στην παραλαβή) — ποτέ κράτηση/δεδομένα.
  if (m === "DELETE") return /^\/api\/contracts\/(?!walk-in(\/|$))[^/]+\/photos\/[^/]+$/.test(pathname);
  return READ_ONLY_ALLOWED.some((re) => re.test(pathname));
}

/** Το μήνυμα του 403 «μόνο ανάγνωση» (ΕΛ — όπως όλα τα μηνύματα των API). */
export const READ_ONLY_MESSAGE =
  "Η εταιρία είναι σε λειτουργία μόνο ανάγνωσης. Ενεργοποιήστε τη συνδρομή από τη σελίδα «Συνδρομή» για να συνεχίσετε.";

/** Απλήρωτη: η συνδρομή υπάρχει, λείπει η πληρωμή → ενημέρωση κάρτας, όχι «ενεργοποίηση». */
export const READ_ONLY_UNPAID_MESSAGE =
  "Η εταιρία είναι σε λειτουργία μόνο ανάγνωσης. Ενημέρωσε την κάρτα από τη σελίδα Συνδρομή για να συνεχίσεις.";

export const readOnlyMessage = (reason: ReadOnlyReason | undefined): string =>
  reason === "unpaid" ? READ_ONLY_UNPAID_MESSAGE : READ_ONLY_MESSAGE;

/* ── Τιμές ── */

/** Τιμή ιδρυτή: 50% (στρογγυλό σε cent). 3900 → 1950. */
export const founderPriceCents = (cents: number): number => Math.round((cents * (100 - FOUNDER_DISCOUNT_PERCENT)) / 100);

/* ── MRR (Super Admin) ── */

/** Καταστάσεις που μετρούν στο MRR: «Ενεργή» και «Απλήρωτη». */
export const MRR_STATUSES = ["active", "past_due", "unpaid"] as const;

export interface MrrInput {
  billingStatus: string;
  billingInterval: string;
  /** Τιμές του πλάνου (plans.priceMonthlyCents / priceYearlyCents). null = δεν πωλείται. */
  priceMonthlyCents: number | null;
  priceYearlyCents: number | null;
  isFounder: boolean;
  founderRows: FounderInvoiceRow[];
  founderDiscountEndsAt: Date | null;
}

/**
 * Η ΤΡΕΧΟΥΣΑ μηνιαία χρέωση μιας εταιρίας (cents) για το MRR.
 * · Μόνο «Ενεργή» (active) ή «Απλήρωτη» (past_due/unpaid)· δοκιμή, εκτός
 *   χρέωσης, αναμονή κάρτας, ακυρωμένη κ.λπ. → 0.
 * · Ετήσια: τιμή έτους ÷ 12.
 * · Ιδρυτής: 50% μόνο όσο η έκπτωση ισχύει — λιγότεροι από 12 πληρωμένοι
 *   μήνες, ή η περίοδος του 12ου δεν έχει τελειώσει (founderDiscountEndsAt).
 */
export function tenantMrrCents(t: MrrInput, now = new Date()): number {
  if (!(MRR_STATUSES as readonly string[]).includes(t.billingStatus)) return 0;
  const yearly = t.billingInterval === "year";
  const base = yearly ? t.priceYearlyCents : t.priceMonthlyCents;
  if (base === null || !Number.isFinite(base) || base <= 0) return 0;
  const discounted =
    t.isFounder &&
    (founderMonthsPaid(t.founderRows) < FOUNDER_DISCOUNT_MONTHS ||
      (t.founderDiscountEndsAt !== null && now.getTime() < t.founderDiscountEndsAt.getTime()));
  const charge = discounted ? founderPriceCents(base) : base;
  return Math.round(yearly ? charge / 12 : charge);
}

/* ── Env (ονόματα, ποτέ τιμές) ── */

export const BILLING_WEBHOOK_ENV = "STRIPE_BILLING_WEBHOOK_SECRET";

export const priceEnvName = (plan: BillingPlanKey, interval: BillingInterval): string =>
  `STRIPE_BILLING_PRICE_${plan.toUpperCase()}_${interval === "month" ? "MONTHLY" : "YEARLY"}`;

export const BILLING_PRICE_ENVS: string[] = BILLING_PLAN_KEYS.flatMap((p) =>
  BILLING_INTERVALS.map((i) => priceEnvName(p, i))
);

export interface BillingConfig {
  ready: boolean;
  /** Ονόματα που λείπουν ή είναι λάθος (π.χ. live κλειδί). */
  problems: string[];
  /** price id → πλάνο/διάστημα. */
  prices: Record<string, { plan: BillingPlanKey; interval: BillingInterval }>;
}

/**
 * Το Billing είναι ΜΟΝΟ test mode σε αυτή τη φάση: με live κλειδί (sk_live_)
 * απενεργοποιείται ολόκληρο (καμία χρέωση, κανένα Checkout).
 */
export function readBillingConfig(env: Record<string, string | undefined>): BillingConfig {
  const v = (n: string) => (env[n] ?? "").trim();
  const problems: string[] = [];
  const key = v("STRIPE_SECRET_KEY");
  if (!key) problems.push("STRIPE_SECRET_KEY");
  else if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) problems.push("STRIPE_SECRET_KEY (όχι test)");
  if (!v(BILLING_WEBHOOK_ENV)) problems.push(BILLING_WEBHOOK_ENV);
  const prices: BillingConfig["prices"] = {};
  for (const plan of BILLING_PLAN_KEYS) {
    for (const interval of BILLING_INTERVALS) {
      const name = priceEnvName(plan, interval);
      const id = v(name);
      if (!/^price_[A-Za-z0-9]+$/.test(id)) problems.push(name);
      else prices[id] = { plan, interval };
    }
  }
  return { ready: problems.length === 0, problems, prices };
}

/* ── Stripe subscription → εταιρία ── */

/** Ό,τι διαβάζουμε από μια συνδρομή του Stripe (υποσύνολο, χωρίς τύπους της βιβλιοθήκης). */
export interface SubscriptionSnapshot {
  id: string;
  status: string;
  priceId: string | null;
  trialEnd: number | null; // unix seconds
  /** Αρχή της τρέχουσας περιόδου (ώρα του Stripe — και του test clock). */
  currentPeriodStart?: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

export interface TenantBillingRow extends BillingState {
  status: string; // TenantStatus
  planKey: string | null;
  billingInterval: string;
  stripeSubId: string | null;
}

export interface TenantBillingPatch {
  billingStatus: BillingStatus;
  stripeSubId: string;
  trialEndsAt?: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: Date | null;
  planKey?: BillingPlanKey;
  plan?: "STARTER" | "PRO" | "ENTERPRISE";
  billingInterval?: BillingInterval;
  status?: "TRIAL" | "ACTIVE";
}

const fromUnix = (s: number | null): Date | null => (typeof s === "number" && s > 0 ? new Date(s * 1000) : null);
const latest = (a: Date, b: Date | null): Date => (b && b.getTime() > a.getTime() ? b : a);

/**
 * Η κατάσταση μιας συνδρομής → αλλαγές στην εταιρία. null = αγνόησε (παλιά
 * συνδρομή που δεν είναι πια της εταιρίας). Ίδια συνάρτηση για webhook και
 * για τον εφεδρικό έλεγχο μετά το Checkout — δεν εξαρτάται από τη σειρά των events.
 *
 * · Πλάνο/διάστημα ΜΟΝΟ από price id που ξέρουμε (env). Άγνωστο → δεν αλλάζει.
 * · pastDueSince: μπαίνει την ΠΡΩΤΗ φορά που γίνεται απλήρωτη, σβήνει με πληρωμή.
 *   Ποτέ ΠΡΙΝ από την αρχή της τρέχουσας περιόδου του Stripe: η αποτυχημένη
 *   χρέωση γίνεται στην αρχή της περιόδου ή μετά. Έτσι μια παλιά/λάθος «ώρα»
 *   (π.χ. test clock που δεν ενημερώθηκε ακόμα) δεν «τρώει» τις 7 ημέρες χάρης.
 *   Στην πραγματική ώρα now ≥ αρχή περιόδου πάντα → καμία αλλαγή.
 * · tenants.status: μόνο TRIAL ↔ ACTIVE (ποτέ δεν πειράζει αναστολή/ακύρωση του Super Admin).
 */
export function subscriptionPatch(
  current: TenantBillingRow,
  sub: SubscriptionSnapshot,
  prices: BillingConfig["prices"],
  now = new Date()
): TenantBillingPatch | null {
  const status: BillingStatus = isBillingStatus(sub.status) && sub.status !== "exempt" ? sub.status : "incomplete";
  // Άλλη συνδρομή από αυτή της εταιρίας: μόνο αν η τρέχουσα δεν ζει πια και η νέα ζει.
  if (current.stripeSubId && current.stripeSubId !== sub.id) {
    const currentAlive = !["canceled", "incomplete_expired"].includes(current.billingStatus);
    const incomingAlive = ["trialing", "active", "past_due", "unpaid"].includes(status);
    if (currentAlive || !incomingAlive) return null;
  }
  const unpaid = status === "past_due" || status === "unpaid";
  const patch: TenantBillingPatch = {
    billingStatus: status,
    stripeSubId: sub.id,
    currentPeriodEnd: fromUnix(sub.currentPeriodEnd),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    pastDueSince: unpaid ? current.pastDueSince ?? latest(now, fromUnix(sub.currentPeriodStart ?? null)) : null,
  };
  if (status === "trialing") patch.trialEndsAt = fromUnix(sub.trialEnd);
  const price = sub.priceId ? prices[sub.priceId] : undefined;
  if (price) {
    patch.planKey = price.plan;
    patch.plan = SUBSCRIPTION_PLAN_OF[price.plan];
    patch.billingInterval = price.interval;
  }
  if (current.status === "TRIAL" || current.status === "ACTIVE") {
    if (status === "trialing") patch.status = "TRIAL";
    else if (status === "active" || unpaid) patch.status = "ACTIVE";
  }
  return patch;
}

/* ── Δοκιμή ιδρυτή / Checkout ── */

/** Λήξη δοκιμής ιδρυτή από το πρώτο όχημα. */
export const founderTrialEnd = (start: Date): Date => new Date(start.getTime() + FOUNDER_TRIAL_DAYS * DAY);

/** Το Stripe Checkout θέλει trial_end τουλάχιστον 48 ώρες μετά· κρατάμε περιθώριο. */
export const MIN_CHECKOUT_TRIAL_MS = 49 * 3_600_000;

export type CheckoutPlan =
  | { kind: "card_trial"; trialDays: number }
  | { kind: "trial_until"; trialEnd: Date }
  | { kind: "pay_now"; founderCoupon: boolean };

/**
 * Πώς ανοίγει το Checkout:
 * · Χωρίς κωδικό ιδρυτή (awaiting_checkout): 14 ημέρες δοκιμή με κάρτα.
 * · Ιδρυτής ΠΡΙΝ λήξει η δοκιμή: κάρτα τώρα, χρέωση στο τέλος της ΔΙΚΗΣ ΤΟΥ
 *   δοκιμής (trial_end) — η έκπτωση μπαίνει από το webhook στο πρώτο
 *   τιμολόγιο (δεν «καίει» μήνες στη δοκιμή).
 * · Ιδρυτής μετά τη λήξη (ή < 49 ώρες πριν): πληρωμή τώρα, με την έκπτωση
 *   ΜΙΑΣ φοράς στο πρώτο τιμολόγιο.
 * · Παλιά συνδρομή που ακυρώθηκε: πληρωμή τώρα (ο ιδρυτής κρατά την έκπτωση
 *   όσο δεν έχουν συμπληρωθεί οι 12 μήνες).
 */
export function checkoutPlan(
  t: { billingStatus: string; trialEndsAt: Date | null },
  isFounder: boolean,
  founderMonthsLeft: number,
  now = new Date()
): CheckoutPlan {
  if (t.billingStatus === "awaiting_checkout") return { kind: "card_trial", trialDays: CARD_TRIAL_DAYS };
  if (t.billingStatus === "founder_trial") {
    const end = t.trialEndsAt ?? founderTrialEnd(now);
    if (end.getTime() - now.getTime() >= MIN_CHECKOUT_TRIAL_MS) return { kind: "trial_until", trialEnd: end };
  }
  return { kind: "pay_now", founderCoupon: isFounder && founderMonthsLeft > 0 };
}

/** Μπορεί να ανοίξει Checkout; (όχι αν υπάρχει ήδη ζωντανή συνδρομή → Πύλη πελάτη). */
export const canStartCheckout = (billingStatus: string): boolean =>
  ["founder_trial", "awaiting_checkout", "canceled", "incomplete", "incomplete_expired"].includes(billingStatus);

/** Έχει ζωντανή συνδρομή στο Stripe → η αλλαγή πλάνου/κάρτας/ακύρωση γίνεται στην Πύλη. */
export const hasLiveSubscription = (billingStatus: string): boolean =>
  ["trialing", "active", "past_due", "unpaid", "paused"].includes(billingStatus);

/* ── Έκπτωση ιδρυτή: 12 ΠΛΗΡΩΜΕΝΟΙ μήνες ── */

export interface FounderInvoiceRow {
  months: number;
  status: string; // open | paid | void
}

/** Μήνες που «έχουν δεσμευτεί» (πληρωμένοι + ανοιχτοί με έκπτωση). Τα void δεν μετρούν. */
export const founderMonthsUsed = (rows: FounderInvoiceRow[]): number =>
  rows.filter((r) => r.status !== "void").reduce((s, r) => s + r.months, 0);

export const founderMonthsPaid = (rows: FounderInvoiceRow[]): number =>
  rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.months, 0);

export const founderMonthsLeft = (rows: FounderInvoiceRow[]): number =>
  Math.max(0, FOUNDER_DISCOUNT_MONTHS - founderMonthsUsed(rows));

/** Μήνες που καλύπτει ένα τιμολόγιο συνδρομής. */
export const invoiceMonths = (interval: BillingInterval): 1 | 12 => (interval === "year" ? 12 : 1);

/** Ό,τι διαβάζουμε από ένα τιμολόγιο του Stripe. */
export interface InvoiceSnapshot {
  id: string;
  status: string; // draft | open | paid | void | uncollectible
  billingReason: string | null;
  subscriptionId: string | null;
  amountDue: number;
  /** Πληρωμένο ποσό (cents) — για την ένδειξη «πλήρης χρέωση». */
  amountPaid?: number;
  priceId: string | null;
  periodEnd: number | null;
  hasDiscount: boolean;
}

export type FounderInvoiceDecision =
  | { apply: true; months: 1 | 12 }
  | { apply: false; why: "not_founder" | "not_draft" | "not_cycle" | "free" | "used_up" | "already" | "unknown_price" };

/**
 * Μπαίνει η έκπτωση 50% σε αυτό το τιμολόγιο; (event invoice.created)
 *
 * Η έκπτωση μπαίνει ΑΝΑ ΤΙΜΟΛΟΓΙΟ και μετριέται σε δικό μας πίνακα, γιατί ένα
 * coupon «repeating 12 μήνες» στη συνδρομή μετρά από τη στιγμή που μπαίνει —
 * άρα και τις ημέρες της δοκιμής. Έτσι οι 12 μήνες μετρούν από την ΠΡΩΤΗ
 * ΠΛΗΡΩΜΗ, ακόμα και με αλλαγή πλάνου ή αποτυχημένη πληρωμή (void → δεν μετρά).
 *
 * Μόνο τιμολόγια κύκλου (subscription_cycle) σε draft: το Stripe τα κρατά
 * draft ~1 ώρα μετά το invoice.created (και περιμένει το webhook μας έως 72
 * ώρες), οπότε η έκπτωση προλαβαίνει. Τα τιμολόγια αναλογικής χρέωσης
 * (αλλαγή πλάνου στη μέση του μήνα) ΔΕΝ παίρνουν έκπτωση και δεν μετρούν.
 */
export function founderInvoiceDecision(
  inv: InvoiceSnapshot,
  isFounder: boolean,
  rows: FounderInvoiceRow[],
  prices: BillingConfig["prices"],
  alreadyRecorded: boolean
): FounderInvoiceDecision {
  if (!isFounder) return { apply: false, why: "not_founder" };
  if (alreadyRecorded || inv.hasDiscount) return { apply: false, why: "already" };
  if (inv.status !== "draft") return { apply: false, why: "not_draft" };
  if (inv.billingReason !== "subscription_cycle" || !inv.subscriptionId) return { apply: false, why: "not_cycle" };
  if (inv.amountDue <= 0) return { apply: false, why: "free" };
  const price = inv.priceId ? prices[inv.priceId] : undefined;
  if (!price) return { apply: false, why: "unknown_price" };
  if (founderMonthsLeft(rows) <= 0) return { apply: false, why: "used_up" };
  return { apply: true, months: invoiceMonths(price.interval) };
}

/**
 * «Πλήρης χρέωση χωρίς έκπτωση» (invoice.paid): ιδρυτής με μήνες που απομένουν
 * πλήρωσε τιμολόγιο > 0 χωρίς έκπτωση και όχι μέσω Checkout με coupon. Π.χ.
 * λήξη δοκιμής «τώρα» από το Dashboard ή αλλαγή πλάνου με άμεση χρέωση.
 * ΜΟΝΟ ένδειξη για τον Super Admin — καμία αυτόματη επιστροφή.
 */
export function founderFullCharge(
  inv: InvoiceSnapshot & { founderCoupon?: boolean },
  isFounder: boolean,
  rows: FounderInvoiceRow[],
  recordedWithDiscount: boolean
): boolean {
  if (!isFounder || recordedWithDiscount) return false;
  if (founderMonthsLeft(rows) <= 0) return false;
  const paid = inv.amountPaid ?? inv.amountDue;
  if (paid <= 0) return false;
  return !inv.hasDiscount && !inv.founderCoupon;
}

/* ── Ειδοποίηση 30 ημέρες πριν την κανονική τιμή ── */

/**
 * Πότε τελειώνει η έκπτωση: στο τέλος της περιόδου του τιμολογίου που
 * συμπλήρωσε τους 12 μήνες. null = δεν συμπληρώθηκαν ακόμα.
 */
export function founderDiscountEnd(rows: (FounderInvoiceRow & { periodEnd: Date | null })[]): Date | null {
  if (founderMonthsUsed(rows) < FOUNDER_DISCOUNT_MONTHS) return null;
  const ends = rows.filter((r) => r.status !== "void" && r.periodEnd).map((r) => r.periodEnd!.getTime());
  return ends.length ? new Date(Math.max(...ends)) : null;
}

/** Η ειδοποίηση οφείλεται από (τέλος − 30 ημέρες) και μία φορά. */
export function founderNoticeDue(
  t: { founderDiscountEndsAt: Date | null; founderNoticeSentAt: Date | null; billingStatus: string },
  now = new Date()
): boolean {
  if (!t.founderDiscountEndsAt || t.founderNoticeSentAt) return false;
  if (!hasLiveSubscription(t.billingStatus)) return false;
  if (now.getTime() >= t.founderDiscountEndsAt.getTime()) return false;
  return now.getTime() >= t.founderDiscountEndsAt.getTime() - FOUNDER_NOTICE_DAYS * DAY;
}

export interface NoticeEmail {
  to: string;
  subject: string;
  text: string;
  /** Έλεγχος ποσών (verifyOutgoingAmounts) — ok:false → ΔΕΝ στέλνεται. */
  amountCheck: AmountCheck;
}

/** Το κείμενο περνά τον έλεγχο ποσών του #45: μόνο η κανονική τιμή, ακριβώς μία φορά. */
const withAmountCheck = (mail: Omit<NoticeEmail, "amountCheck">, normalCents: number, priceLine: string): NoticeEmail => ({
  ...mail,
  amountCheck: verifyOutgoingAmounts([mail.subject, mail.text].join("\n"), { totalCents: normalCents, totalLine: priceLine }),
});

const fmtDate = (d: Date, lang: "el" | "en") =>
  d.toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Athens" });

/**
 * Το κείμενο της ειδοποίησης «η έκπτωση ιδρυτή τελειώνει». ΜΟΝΟ κείμενο: η
 * αποστολή σε πελάτες θέλει επαληθευμένο domain στο Resend (δεν υπάρχει ακόμα).
 */
export function founderNoticeEmail(
  lang: "el" | "en",
  to: string,
  companyName: string,
  planName: string,
  endsAt: Date,
  normalCents: number,
  interval: BillingInterval
): NoticeEmail {
  const price = formatMoney(normalCents, lang);
  const per = interval === "year" ? (lang === "el" ? "τον χρόνο" : "per year") : lang === "el" ? "τον μήνα" : "per month";
  const priceLine = `${price} ${per}`;
  if (lang === "el") {
    return withAmountCheck({
      to,
      subject: "Η έκπτωση ιδρυτή τελειώνει σε 30 ημέρες — FleetPro",
      text: [
        `Γεια σας,`,
        `Ευχαριστούμε που η ${companyName} είναι μία από τις πρώτες εταιρίες του FleetPro.`,
        `Η έκπτωση 50% των 12 μηνών ολοκληρώνεται στις ${fmtDate(endsAt, "el")}. Από την επόμενη χρέωση η συνδρομή ${planName} θα κοστίζει ${priceLine} (χωρίς ΦΠΑ).`,
        `Δεν χρειάζεται να κάνετε τίποτα. Αν θέλετε να αλλάξετε πλάνο ή κάρτα, μπείτε στο FleetPro → Συνδρομή.`,
        `FleetPro`,
      ].join("\n\n"),
    }, normalCents, priceLine);
  }
  return withAmountCheck({
    to,
    subject: "Your founding discount ends in 30 days — FleetPro",
    text: [
      `Hello,`,
      `Thank you for having ${companyName} among the first companies on FleetPro.`,
      `Your 50% discount for 12 months ends on ${fmtDate(endsAt, "en")}. From the next charge your ${planName} plan will cost ${priceLine} (excl. VAT).`,
      `You don't need to do anything. To change your plan or card, open FleetPro → Subscription.`,
      `FleetPro`,
    ].join("\n\n"),
  }, normalCents, priceLine);
}
