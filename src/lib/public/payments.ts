// src/lib/public/payments.ts
// Online πληρωμές κρατήσεων (Stripe Connect) — ΚΑΘΑΡΗ λογική, χωρίς βάση και
// χωρίς Stripe: τη φορτώνουν server, client και tests.
//
// · Τι επιτρέπεται: οι ρυθμίσεις της εταιρίας ΜΟΝΟ αν ο λογαριασμός Stripe
//   είναι «Ενεργός» (charges + payouts) ΚΑΙ ο server έχει κλειδιά· αλλιώς
//   ΠΑΝΤΑ «στην παραλαβή» (όπως πριν).
// · Ποσό τώρα: από το ΑΠΟΘΗΚΕΥΜΕΝΟ σύνολο της κράτησης (priceQuote.totalCents)
//   — ποτέ από τον browser. Προκαταβολή = ποσοστό, στρογγυλό σε ακέραιο €,
//   τουλάχιστον 1 €, ποτέ πάνω από το σύνολο.
// · Webhook: ποια αλλαγή φέρνει κάθε event (PAID ΜΟΝΟ από εδώ, ποτέ από το
//   success_url), με έλεγχο ποσού/νομίσματος και idempotency.
// · Διαθεσιμότητα: κράτηση που περιμένει πληρωμή κρατά το όχημα ΜΕΧΡΙ τη λήξη.

import { z } from "zod";
import { formatMoney, roundToEuro } from "./money";

export const PAYMENT_OPTIONS = ["PICKUP_ONLY", "ONLINE_OR_PICKUP", "ONLINE_ONLY"] as const;
export type PaymentOptions = (typeof PAYMENT_OPTIONS)[number];

export const ONLINE_AMOUNT_TYPES = ["FULL", "DEPOSIT"] as const;
export type OnlineAmountType = (typeof ONLINE_AMOUNT_TYPES)[number];

export const PAYMENT_METHODS = ["PICKUP", "ONLINE"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["NONE", "AWAITING_PAYMENT", "PAID", "FAILED", "EXPIRED", "REFUNDED", "PARTIALLY_REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Λήξη της Checkout Session (και της «κράτησης» του οχήματος). Το Stripe θέλει ≥ 30΄. */
export const CHECKOUT_TTL_MINUTES = 31;
/** Ελάχιστο ποσό online χρέωσης (cents). */
export const MIN_ONLINE_CENTS = 100;
/** Ο κωδικός ακύρωσης όταν η πληρωμή δεν ολοκληρώθηκε (δεν τον διαλέγει ποτέ ο χρήστης). */
export const PAYMENT_CANCEL_REASON = "payment_not_completed";

export const isPaymentOptions = (v: unknown): v is PaymentOptions => typeof v === "string" && (PAYMENT_OPTIONS as readonly string[]).includes(v);
export const isOnlineAmountType = (v: unknown): v is OnlineAmountType =>
  typeof v === "string" && (ONLINE_AMOUNT_TYPES as readonly string[]).includes(v);

/* ─────────────────────────────────────────────
   Λογαριασμός και επιλογές
   ───────────────────────────────────────────── */

export interface StripeAccountState {
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
}

export type AccountStatus = "NOT_CONNECTED" | "PENDING" | "ACTIVE";

export function accountStatus(a: StripeAccountState): AccountStatus {
  if (!a.stripeAccountId) return "NOT_CONNECTED";
  return a.stripeChargesEnabled && a.stripePayoutsEnabled ? "ACTIVE" : "PENDING";
}

export interface TenantPaymentSettings extends StripeAccountState {
  paymentOptions: string;
  onlineAmountType: string;
  depositPercent: number;
}

/**
 * Οι επιλογές που ΙΣΧΥΟΥΝ: ό,τι όρισε η εταιρία, ΜΟΝΟ με ενεργό λογαριασμό
 * και ρυθμισμένο server (`stripeReady`). Αλλιώς «μόνο στην παραλαβή».
 */
export function effectivePaymentOptions(t: TenantPaymentSettings, stripeReady: boolean): PaymentOptions {
  if (!stripeReady || accountStatus(t) !== "ACTIVE") return "PICKUP_ONLY";
  return isPaymentOptions(t.paymentOptions) ? t.paymentOptions : "PICKUP_ONLY";
}

/** Οι τρόποι που βλέπει ο πελάτης, με τη σειρά τους. */
export function availableMethods(options: PaymentOptions): PaymentMethod[] {
  if (options === "ONLINE_ONLY") return ["ONLINE"];
  if (options === "ONLINE_OR_PICKUP") return ["ONLINE", "PICKUP"];
  return ["PICKUP"];
}

export const PAYMENT_METHOD_MESSAGE = { el: "Διαλέξτε τρόπο πληρωμής.", en: "Choose a payment method." };

/**
 * Ο τρόπος της υποβολής: με ΕΝΑΝ διαθέσιμο, αυτός (ό,τι κι αν ήρθε)· με δύο,
 * ΥΠΟΧΡΕΩΤΙΚΗ ρητή επιλογή από τους διαθέσιμους.
 */
export function resolvePaymentMethod(
  requested: unknown,
  options: PaymentOptions
): { ok: true; method: PaymentMethod } | { ok: false; message: { el: string; en: string } } {
  const methods = availableMethods(options);
  if (methods.length === 1) return { ok: true, method: methods[0] };
  if (typeof requested === "string" && (methods as string[]).includes(requested)) return { ok: true, method: requested as PaymentMethod };
  return { ok: false, message: PAYMENT_METHOD_MESSAGE };
}

/** Οι ρυθμίσεις που αλλάζει η εταιρία (ΟΧΙ η προμήθεια — μόνο ο Super Admin). */
export const paymentSettingsSchema = z.object({
  paymentOptions: z.enum(PAYMENT_OPTIONS),
  onlineAmountType: z.enum(ONLINE_AMOUNT_TYPES),
  depositPercent: z.number().int("Ακέραιο ποσοστό").min(1, "Από 1 έως 100").max(100, "Από 1 έως 100"),
});

/* ─────────────────────────────────────────────
   Ποσά
   ───────────────────────────────────────────── */

/** Πόσο χρεώνεται ΤΩΡΑ online (cents) από το σύνολο της κράτησης. */
export function onlineAmountCents(totalCents: number, type: string, depositPercent: number): number {
  const total = Math.max(0, Math.round(totalCents));
  if (total === 0) return 0;
  if (type !== "DEPOSIT") return total;
  const pct = Math.min(100, Math.max(1, Math.round(depositPercent)));
  const deposit = Math.max(MIN_ONLINE_CENTS, roundToEuro((total * pct) / 100));
  return Math.min(total, deposit);
}

/** Ποσό τώρα + υπόλοιπο στην παραλαβή — για τη φόρμα, τη σύνοψη και τα μηνύματα. */
export function paymentSplit(totalCents: number, type: string, depositPercent: number): { nowCents: number; laterCents: number } {
  const nowCents = onlineAmountCents(totalCents, type, depositPercent);
  return { nowCents, laterCents: Math.max(0, Math.round(totalCents) - nowCents) };
}

/** Προμήθεια πλατφόρμας (cents)· 0 = δεν στέλνεται application_fee_amount. */
export function applicationFeeCents(amountCents: number, feeBps: number): number {
  const bps = Math.min(5000, Math.max(0, Math.round(feeBps)));
  if (bps === 0 || amountCents <= 0) return 0;
  return Math.floor((amountCents * bps) / 10_000);
}

/** Γλώσσα της σελίδας του Stripe από τη γλώσσα του site. */
export function checkoutLocale(lang: string | null | undefined): "el" | "en" | "fr" | "pl" | "de" | "it" | "auto" {
  const l = (lang ?? "").slice(0, 2).toLowerCase();
  return l === "el" || l === "en" || l === "fr" || l === "pl" || l === "de" || l === "it" ? l : "auto";
}

/* ─────────────────────────────────────────────
   Διαθεσιμότητα
   ───────────────────────────────────────────── */

export interface PaymentHold {
  /** Κατάσταση κράτησης· μόνο η PENDING αποδεσμεύει το όχημα όταν λήξει η αναμονή. */
  status?: string;
  paymentStatus?: string | null;
  /** ms (πραγματική στιγμή) */
  paymentExpiresMs?: number | null;
}

/**
 * Η αναμονή πληρωμής έχει λήξει (άρα ΔΕΝ κρατά πια το όχημα);
 * Κράτηση που επιβεβαιώθηκε (CONFIRMED/ACTIVE) κρατά το όχημα ό,τι κι αν
 * έγινε με την πληρωμή — την αποδεσμεύει μόνο η ακύρωση.
 */
export function holdExpired(b: PaymentHold, nowMs: number): boolean {
  if (b.status !== undefined && b.status !== "PENDING") return false;
  return b.paymentStatus === "AWAITING_PAYMENT" && typeof b.paymentExpiresMs === "number" && b.paymentExpiresMs <= nowMs;
}

/**
 * Φίλτρο Prisma: κρατήσεις που ΔΕΝ είναι ληγμένη αναμονή πληρωμής.
 * (Για όλα τα ερωτήματα συγκρούσεων: site, dashboard, walk-in.)
 */
export const notExpiredHold = (now: Date) => ({
  NOT: { status: "PENDING" as const, paymentStatus: "AWAITING_PAYMENT", paymentExpiresAt: { lte: now } },
});

/* ─────────────────────────────────────────────
   Webhook → αλλαγές
   ───────────────────────────────────────────── */

export type CheckoutEvent =
  | { kind: "paid"; amountTotal: number | null; currency: string | null; paymentIntentId: string | null }
  | { kind: "failed" }
  | { kind: "expired" }
  | { kind: "refunded"; amountRefunded: number };

export interface PaymentRowState {
  status: string;
  amountCents: number;
  refundedCents: number;
  /** Κρατήθηκε ως χρέωση ακύρωσης (SQL 28). Πάντα refunded + retained <= amount. */
  retainedCents?: number;
  /** BOOKING (site) | CONTRACT (ενοίκιο από το συμβόλαιο, SQL 29). */
  purpose?: string;
}

export interface BookingPaymentState {
  status: string;
  paymentStatus: string;
  rentalMode: string;
}

export interface Transition {
  booking: { status?: "CONFIRMED" | "CANCELLED"; paymentStatus: PaymentStatus; cancelReasonCode?: string; clearExpiry?: boolean };
  payment: { status: string; refundedCents?: number; retainedCents?: number; paidAt?: boolean; paymentIntentId?: string | null };
  /** Πληρώθηκε κράτηση που είχε ήδη ακυρωθεί → θέλει επιστροφή από την εταιρία. */
  needsRefund?: boolean;
}

export type TransitionResult = { ok: true; t: Transition } | { ok: false; reason: "noop" | "amount_mismatch" };

export function transitionFor(b: BookingPaymentState, p: PaymentRowState, e: CheckoutEvent): TransitionResult {
  const r = bookingTransitionFor(b, p, e);
  // Πληρωμή ΣΥΜΒΟΛΑΙΟΥ: αλλάζει ΜΟΝΟ η γραμμή πληρωμής — η κράτηση (κατάσταση,
  // αναμονή, ένδειξη πληρωμής του site) μένει όπως είναι.
  if (!r.ok || p.purpose !== "CONTRACT") return r;
  return { ok: true, t: { booking: { paymentStatus: b.paymentStatus as PaymentStatus }, payment: r.t.payment } };
}

function bookingTransitionFor(b: BookingPaymentState, p: PaymentRowState, e: CheckoutEvent): TransitionResult {
  if (e.kind === "paid") {
    if (p.status === "PAID" || p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED") return { ok: false, reason: "noop" };
    if (e.amountTotal !== p.amountCents || (e.currency ?? "").toLowerCase() !== "eur") return { ok: false, reason: "amount_mismatch" };
    const cancelled = b.status === "CANCELLED";
    const confirm = !cancelled && b.status === "PENDING" && b.rentalMode === "BOOKING";
    return {
      ok: true,
      t: {
        booking: { ...(confirm ? { status: "CONFIRMED" as const } : {}), paymentStatus: "PAID", clearExpiry: true },
        payment: { status: "PAID", paidAt: true, paymentIntentId: e.paymentIntentId },
        ...(cancelled ? { needsRefund: true } : {}),
      },
    };
  }

  if (e.kind === "failed" || e.kind === "expired") {
    // Ήδη πληρωμένη (π.χ. «expired» μετά από επιτυχία) ή ήδη κλεισμένη: τίποτα.
    if (p.status !== "OPEN") return { ok: false, reason: "noop" };
    const status = e.kind === "failed" ? "FAILED" : "EXPIRED";
    // Η κράτηση ακυρώνεται ΜΟΝΟ αν περίμενε ακόμα ΑΥΤΗ την πληρωμή.
    const waiting = b.paymentStatus === "AWAITING_PAYMENT";
    const cancel = waiting && b.status === "PENDING";
    return {
      ok: true,
      t: {
        booking: waiting
          ? { ...(cancel ? { status: "CANCELLED" as const, cancelReasonCode: PAYMENT_CANCEL_REASON } : {}), paymentStatus: status, clearExpiry: true }
          : { paymentStatus: b.paymentStatus as PaymentStatus },
        payment: { status },
      },
    };
  }

  // refunded: το Stripe δίνει το ΣΥΝΟΛΙΚΟ ποσό επιστροφής της χρέωσης.
  if (p.status !== "PAID" && p.status !== "PARTIALLY_REFUNDED" && p.status !== "REFUNDED") return { ok: false, reason: "noop" };
  const refunded = Math.min(p.amountCents, Math.max(0, Math.round(e.amountRefunded)));
  if (refunded <= p.refundedCents) return { ok: false, reason: "noop" };
  const status = refunded >= p.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
  const retained = retainedAfterRefund(p, refunded);
  return {
    ok: true,
    t: {
      booking: { paymentStatus: status },
      payment: { status, refundedCents: refunded, ...(retained !== (p.retainedCents ?? 0) ? { retainedCents: retained } : {}) },
    },
  };
}

/** Μετά από επιστροφή: ό,τι είχε κρατηθεί μειώνεται, ώστε refunded + retained <= amount. */
export const retainedAfterRefund = (p: PaymentRowState, refundedCents: number): number =>
  Math.max(0, Math.min(p.retainedCents ?? 0, p.amountCents - refundedCents));

/* ─────────────────────────────────────────────
   Επιστροφή χρημάτων (dashboard)
   ───────────────────────────────────────────── */

export const REFUND_MSG = {
  role: "Δεν έχετε δικαίωμα για επιστροφή χρημάτων",
  notFound: "Η κράτηση δεν βρέθηκε",
  notCancelled: "Επιστροφή χρημάτων γίνεται μόνο σε ακυρωμένη κράτηση.",
  notPaid: "Η κράτηση δεν έχει online πληρωμή για επιστροφή.",
  amount: (max: string) => `Το ποσό πρέπει να είναι από 0,01 έως ${max}.`,
  stripe: "Το Stripe δεν δέχτηκε την επιστροφή. Δοκιμάστε ξανά ή δείτε τον πίνακα Stripe.",
  notConfigured: "Οι online πληρωμές δεν είναι ρυθμισμένες στον server.",
} as const;

/** Ο συνεργάτης ΜΟΝΟ βλέπει· επιστροφή ΜΟΝΟ από Διαχειριστή. */
export const canRefund = (role: string): boolean => role === "COMPANY_ADMIN";

/** Κράτηση υπολοίπου (χρέωση ακύρωσης): ΜΟΝΟ Διαχειριστής. */
export const canRetain = (role: string): boolean => role === "COMPANY_ADMIN";

/** «Έλεγχος πληρωμής στο Stripe»: Διαχειριστής και Υπάλληλος (ο συνεργάτης μόνο βλέπει). */
export const canCheckPayment = (role: string): boolean => role === "COMPANY_ADMIN" || role === "STAFF";

/** Ποιες online κρατήσεις έχει νόημα να ξαναρωτηθούν στο Stripe. */
export const CHECKABLE_PAYMENT_STATUSES = ["AWAITING_PAYMENT", "EXPIRED", "FAILED"] as const;
export const isCheckable = (b: { paymentMethod: string | null; paymentStatus: string }): boolean =>
  b.paymentMethod === "ONLINE" && (CHECKABLE_PAYMENT_STATUSES as readonly string[]).includes(b.paymentStatus);

/** Ό,τι ΔΕΝ έχει ούτε επιστραφεί ούτε κρατηθεί — αυτό θέλει απόφαση σε ακυρωμένη κράτηση. */
export const outstandingCents = (p: PaymentRowState): number =>
  p.status === "PAID" || p.status === "PARTIALLY_REFUNDED" ? Math.max(0, p.amountCents - p.refundedCents - (p.retainedCents ?? 0)) : 0;

/** Ακυρωμένη, πληρωμένη, με ποσό χωρίς απόφαση (ούτε επιστροφή ούτε κράτηση) → προειδοποίηση. */
export const needsDecision = (bookingStatus: string, p: PaymentRowState | null | undefined): boolean =>
  bookingStatus === "CANCELLED" && !!p && outstandingCents(p) > 0;

export const RETAIN_MSG = {
  role: "Μόνο ο Διαχειριστής αποφασίζει για το υπόλοιπο της πληρωμής",
  notFound: "Η κράτηση δεν βρέθηκε",
  notCancelled: "Το υπόλοιπο κρατείται μόνο σε ακυρωμένη κράτηση.",
  nothing: "Δεν υπάρχει υπόλοιπο πληρωμής χωρίς απόφαση.",
  changed: "Η πληρωμή άλλαξε στο μεταξύ. Ανανεώστε τη σελίδα και δοκιμάστε ξανά.",
} as const;

/**
 * Φίλτρο της εγγραφής «κρατείται»: γράφει ΜΟΝΟ αν η πληρωμή είναι ακόμα όπως
 * τη διαβάσαμε — αλλιώς μια ταυτόχρονη επιστροφή θα έδινε refunded + retained > amount.
 */
export const retainWhere = (p: { id: string; tenantId: string; bookingId: string; refundedCents: number; retainedCents: number }) => ({
  id: p.id,
  tenantId: p.tenantId,
  bookingId: p.bookingId,
  status: { in: ["PAID", "PARTIALLY_REFUNDED"] },
  refundedCents: p.refundedCents,
  retainedCents: p.retainedCents,
});

export const RETAIN_NOTE_MAX = 300;

/**
 * «Το υπόλοιπο κρατείται»: ό,τι δεν επιστράφηκε γίνεται χρέωση ακύρωσης.
 * Επιστρέφει το ΝΕΟ συνολικό retainedCents (= amount − refunded).
 */
export function checkRetain(
  booking: { status: string } | null,
  payment: PaymentRowState | null
): { ok: true; retainedCents: number; addedCents: number } | { ok: false; status: 400 | 404; message: string } {
  if (!booking) return { ok: false, status: 404, message: RETAIN_MSG.notFound };
  if (booking.status !== "CANCELLED") return { ok: false, status: 400, message: RETAIN_MSG.notCancelled };
  const add = payment ? outstandingCents(payment) : 0;
  if (!payment || add <= 0) return { ok: false, status: 400, message: RETAIN_MSG.nothing };
  return { ok: true, retainedCents: (payment.retainedCents ?? 0) + add, addedCents: add };
}

/**
 * Η γραμμή πληρωμής μετά από επιστροφή amountCents, από την ΤΡΕΧΟΥΣΑ (κλειδωμένη)
 * εγγραφή — ώστε δύο ταυτόχρονες επιστροφές να αθροίζονται, όχι να σβήνει η μία
 * την άλλη. Ποτέ πάνω από το ποσό της πληρωμής.
 */
export function refundRowAfter(
  fresh: PaymentRowState,
  amountCents: number
): { refundedCents: number; retainedCents: number; status: "REFUNDED" | "PARTIALLY_REFUNDED" } {
  const refundedCents = Math.min(fresh.amountCents, fresh.refundedCents + amountCents);
  return {
    refundedCents,
    retainedCents: retainedAfterRefund(fresh, refundedCents),
    status: refundedCents >= fresh.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED",
  };
}

/** Πόσο μπορεί ακόμα να επιστραφεί από μια πληρωμή (cents). */
export const refundableCents = (p: PaymentRowState): number =>
  p.status === "PAID" || p.status === "PARTIALLY_REFUNDED" ? Math.max(0, p.amountCents - p.refundedCents) : 0;

export function checkRefund(
  booking: { status: string } | null,
  payment: PaymentRowState | null,
  amountCents: number | null
): { ok: true; amountCents: number } | { ok: false; status: 400 | 404; message: string } {
  if (!booking) return { ok: false, status: 404, message: REFUND_MSG.notFound };
  // Πληρωμή κράτησης (site): μόνο σε ακυρωμένη. Πληρωμή ΣΥΜΒΟΛΑΙΟΥ (ενοίκιο):
  // σε οποιαδήποτε κατάσταση — π.χ. διόρθωση ποσού μετά την ενοικίαση.
  if (payment?.purpose !== "CONTRACT" && booking.status !== "CANCELLED") return { ok: false, status: 400, message: REFUND_MSG.notCancelled };
  const max = payment ? refundableCents(payment) : 0;
  if (!payment || max <= 0) return { ok: false, status: 400, message: REFUND_MSG.notPaid };
  const amount = amountCents === null ? max : Math.round(amountCents);
  if (!Number.isFinite(amount) || amount < 1 || amount > max) {
    return { ok: false, status: 400, message: REFUND_MSG.amount(formatMoney(max, "el", { decimals: "always" })) };
  }
  return { ok: true, amountCents: amount };
}

/* ─────────────────────────────────────────────
   Εμφάνιση
   ───────────────────────────────────────────── */

export type PaymentBadge = "PICKUP" | "AWAITING" | "PAID" | "PARTIAL_REFUND" | "REFUNDED" | "NOT_COMPLETED" | null;

/** Η ένδειξη πληρωμής μιας κράτησης (dashboard / σελίδα πελάτη). */
export function paymentBadge(b: { paymentMethod: string | null; paymentStatus: string }, nowMs: number, expiresMs: number | null): PaymentBadge {
  if (b.paymentMethod === "PICKUP") return "PICKUP";
  if (b.paymentMethod !== "ONLINE") return null;
  switch (b.paymentStatus) {
    case "AWAITING_PAYMENT":
      return holdExpired({ paymentStatus: b.paymentStatus, paymentExpiresMs: expiresMs }, nowMs) ? "NOT_COMPLETED" : "AWAITING";
    case "PAID":
      return "PAID";
    case "PARTIALLY_REFUNDED":
      return "PARTIAL_REFUND";
    case "REFUNDED":
      return "REFUNDED";
    case "FAILED":
    case "EXPIRED":
      return "NOT_COMPLETED";
    default:
      return null;
  }
}

export interface DashboardPaymentText {
  /** Κλειδί του λεξικού του dashboard (decision.*). */
  key: "payPickup" | "payAwaiting" | "payPaid" | "payPaidFull" | "payRefunded" | "payPartRefund" | "payRetained" | "payRefundedRetained" | "payNotCompleted";
  /** Ποσά σε cents για τα {placeholders}. */
  vars: Record<string, number>;
  tone: "muted" | "warn" | "ok" | "info" | "bad";
}

/**
 * Το κείμενο πληρωμής στην κάρτα του dashboard. Σε online κράτηση ΠΟΤΕ
 * «Πληρωμή στην παραλαβή». Επιστροφή/κράτηση ποσού έχουν προτεραιότητα.
 */
export function dashboardPaymentText(
  b: { status: string; paymentMethod: string | null; paymentStatus: string; totalCents: number },
  p: PaymentRowState | null,
  nowMs: number,
  expiresMs: number | null
): DashboardPaymentText | null {
  const badge = paymentBadge(b, nowMs, expiresMs);
  if (!badge) return null;
  if (badge === "PICKUP") return { key: "payPickup", vars: {}, tone: "muted" };
  if (badge === "AWAITING") return { key: "payAwaiting", vars: {}, tone: "warn" };
  const paid = p && (badge === "PAID" || badge === "PARTIAL_REFUND" || badge === "REFUNDED") ? p.amountCents : 0;
  if (!p || paid === 0) return { key: "payNotCompleted", vars: {}, tone: "bad" };
  const refunded = p.refundedCents;
  const retained = p.retainedCents ?? 0;
  if (refunded > 0 && retained > 0) return { key: "payRefundedRetained", vars: { refunded, retained }, tone: "info" };
  if (retained > 0) return { key: "payRetained", vars: { amount: retained }, tone: "info" };
  if (refunded >= paid) return { key: "payRefunded", vars: { amount: refunded }, tone: "info" };
  if (refunded > 0) return { key: "payPartRefund", vars: { refunded, paid }, tone: "info" };
  const balance = b.status === "CANCELLED" ? 0 : Math.max(0, b.totalCents - paid);
  return balance > 0 ? { key: "payPaid", vars: { paid, balance }, tone: "ok" } : { key: "payPaidFull", vars: { paid }, tone: "ok" };
}

/** Link προς την πληρωμή στον πίνακα Stripe (η εταιρία βλέπει τον δικό της λογαριασμό). */
export function stripeDashboardPaymentUrl(paymentIntentId: string | null, live: boolean): string | null {
  if (!paymentIntentId || !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) return null;
  return `https://dashboard.stripe.com/${live ? "" : "test/"}payments/${paymentIntentId}`;
}
