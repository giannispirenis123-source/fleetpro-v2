// src/lib/public/paymentServer.ts
// Online πληρωμές κρατήσεων — η σύνδεση με τη βάση και το Stripe. ΜΟΝΟ server.
// Η εταιρία ΠΑΝΤΑ από τη συνεδρία ή το slug του site· κάθε ερώτημα φιλτράρει
// με αυτήν. Ποσά ΜΟΝΟ από το αποθηκευμένο priceQuote της κράτησης.

import { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "../db";
import { syncVehicleStatus } from "../bookingLifecycle";
import { stripe, stripeErrorCode, stripeReady, accountFlags } from "../stripeConnect";
import { storefrontDictionary, fill } from "../storefront/i18n";
import { storefrontPath } from "../storefront/slug";
import {
  CHECKOUT_TTL_MINUTES,
  PAYMENT_CANCEL_REASON,
  applicationFeeCents,
  checkoutLocale,
  effectivePaymentOptions,
  onlineAmountCents,
  refundRowAfter,
  retainWhere,
  type PaymentOptions,
  type TenantPaymentSettings,
  type Transition,
} from "./payments";
import { checkSessionNow, type WebhookOutcome, type WebhookStore } from "./paymentWebhook";
import { hitLimit, LIMITS } from "./rateLimit";
import { dbCounterStore } from "./rateLimitStore";

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

export const PAYMENT_SETTINGS_SELECT = {
  stripeAccountId: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeDetailsSubmitted: true,
  paymentOptions: true,
  onlineAmountType: true,
  depositPercent: true,
} as const;

/** Οι ρυθμίσεις + οι επιλογές που ΙΣΧΥΟΥΝ (online μόνο με ενεργό λογαριασμό και κλειδιά). */
export async function loadSitePayment(companyId: string): Promise<{ settings: TenantPaymentSettings; options: PaymentOptions } | null> {
  const t = await db.tenant.findUnique({ where: { id: companyId }, select: PAYMENT_SETTINGS_SELECT });
  if (!t) return null;
  return { settings: t, options: effectivePaymentOptions(t, stripeReady()) };
}

/**
 * Αναμονές πληρωμής που έληξαν χωρίς webhook: ακύρωση (το όχημα ελευθερώνεται
 * ούτως ή άλλως από τους ελέγχους διαθεσιμότητας — εδώ καθαρίζει η εικόνα).
 */
export async function expireStaleHolds(client: Client, tenantId: string, now = new Date()): Promise<number> {
  const where = { tenantId, status: "PENDING" as const, paymentStatus: "AWAITING_PAYMENT", paymentExpiresAt: { lte: now } };
  const stale = await client.booking.findMany({ where, select: { id: true } });
  if (stale.length === 0) return 0;
  const ids = stale.map((b) => b.id);
  await client.booking.updateMany({
    where: { ...where, id: { in: ids } },
    data: { status: "CANCELLED", paymentStatus: "EXPIRED", cancelReasonCode: PAYMENT_CANCEL_REASON },
  });
  await client.bookingPayment.updateMany({
    where: { tenantId, bookingId: { in: ids }, status: "OPEN" },
    data: { status: "EXPIRED" },
  });
  return ids.length;
}

/* ─────────────────────────────────────────────
   Checkout Session (direct charge στον λογαριασμό της εταιρίας)
   ───────────────────────────────────────────── */

export type CheckoutResult = { ok: true; url: string } | { ok: false; reason: "not_ready" | "stripe" | "amount" };

/**
 * Δημιουργεί τη Checkout Session για μια ΗΔΗ γραμμένη κράτηση (AWAITING_PAYMENT).
 * Ποσό από το ΑΠΟΘΗΚΕΥΜΕΝΟ priceQuote· σε αποτυχία η κράτηση ακυρώνεται
 * αμέσως (ελευθερώνει το όχημα) και ο πελάτης βλέπει μήνυμα.
 */
export async function createBookingCheckout(opts: {
  companyId: string;
  code: string;
  origin: string;
  lang: string;
}): Promise<CheckoutResult> {
  const b = await db.booking.findFirst({
    where: { tenantId: opts.companyId, publicCode: opts.code, paymentStatus: "AWAITING_PAYMENT" },
    select: {
      id: true,
      priceQuote: true,
      total: true,
      siteLang: true,
      paymentExpiresAt: true,
      customer: { select: { email: true } },
      tenant: {
        select: {
          name: true,
          storefrontSlug: true,
          platformFeeBps: true,
          ...PAYMENT_SETTINGS_SELECT,
        },
      },
    },
  });
  if (!b || !b.tenant.stripeAccountId || !b.tenant.storefrontSlug || !b.paymentExpiresAt) return fail(b?.id, opts.companyId, "not_ready");
  if (effectivePaymentOptions(b.tenant, stripeReady()) === "PICKUP_ONLY") return fail(b.id, opts.companyId, "not_ready");

  const q = (b.priceQuote && typeof b.priceQuote === "object" ? b.priceQuote : {}) as { totalCents?: unknown };
  const totalCents = typeof q.totalCents === "number" ? q.totalCents : Math.round(Number(b.total) * 100);
  const amount = onlineAmountCents(totalCents, b.tenant.onlineAmountType, b.tenant.depositPercent);
  if (amount < 50) return fail(b.id, opts.companyId, "amount");
  const fee = applicationFeeCents(amount, b.tenant.platformFeeBps);

  const lang = b.siteLang ?? opts.lang;
  const d = storefrontDictionary(lang);
  const base = `${opts.origin.replace(/\/+$/, "")}${storefrontPath(b.tenant.storefrontSlug, lang)}/booking/${opts.code}`;
  const metadata = { bookingId: b.id, tenantId: opts.companyId, bookingCode: opts.code };
  const deposit = amount < totalCents;

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        // ΜΟΝΟ κάρτα (Apple Pay / Google Pay περνούν ως κάρτα): καμία ασύγχρονη μέθοδος
        // που θα ολοκληρωνόταν μετά τη λήξη της κράτησης.
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: amount,
              product_data: {
                name: fill(d.payCheckoutName, { code: opts.code, company: b.tenant.name }).slice(0, 250),
                ...(deposit ? { description: fill(d.payCheckoutDeposit, { percent: b.tenant.depositPercent }) } : {}),
              },
            },
          },
        ],
        ...(b.customer.email ? { customer_email: b.customer.email } : {}),
        locale: checkoutLocale(lang),
        expires_at: Math.floor(b.paymentExpiresAt.getTime() / 1000),
        success_url: `${base}?paid=1`,
        cancel_url: base,
        client_reference_id: b.id,
        metadata,
        payment_intent_data: {
          metadata,
          description: `${opts.code} · ${b.tenant.name}`.slice(0, 250),
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
        },
      },
      // Ο πελάτης περιμένει: σύντομο όριο, ώστε σε αργό Stripe να δει μήνυμα
      // (και να ελευθερωθεί το όχημα) πριν κοπεί η function.
      { stripeAccount: b.tenant.stripeAccountId, idempotencyKey: `fleetpro-checkout-${b.id}`, timeout: 8_000, maxNetworkRetries: 1 }
    );
  } catch (e) {
    console.error(`[FleetPro] Stripe checkout: ${stripeErrorCode(e)}`);
    return fail(b.id, opts.companyId, "stripe");
  }
  if (!session.url) return fail(b.id, opts.companyId, "stripe");

  await db.bookingPayment.create({
    data: {
      tenantId: opts.companyId,
      bookingId: b.id,
      stripeAccountId: b.tenant.stripeAccountId,
      stripeCheckoutSessionId: session.id,
      checkoutUrl: session.url,
      amountCents: amount,
      applicationFeeCents: fee,
      currency: "eur",
      status: "OPEN",
      expiresAt: b.paymentExpiresAt,
    },
  });
  return { ok: true, url: session.url };
}

/** Η πληρωμή δεν ξεκίνησε: η κράτηση ακυρώνεται αμέσως (ελευθερώνει το όχημα). */
async function fail(bookingId: string | undefined, tenantId: string, reason: "not_ready" | "stripe" | "amount"): Promise<CheckoutResult> {
  if (bookingId) {
    await db.booking.updateMany({
      where: { id: bookingId, tenantId, paymentStatus: "AWAITING_PAYMENT" },
      data: { status: "CANCELLED", paymentStatus: "FAILED", cancelReasonCode: PAYMENT_CANCEL_REASON, paymentExpiresAt: null },
    });
  }
  return { ok: false, reason };
}

/** Πόσα λεπτά κρατά το όχημα η αναμονή πληρωμής. */
export const holdUntil = (now: Date) => new Date(now.getTime() + CHECKOUT_TTL_MINUTES * 60_000);

/* ─────────────────────────────────────────────
   Webhook → βάση
   ───────────────────────────────────────────── */

const toWebhookPayment = (p: {
  id: string;
  tenantId: string;
  bookingId: string;
  status: string;
  amountCents: number;
  refundedCents: number;
  retainedCents: number;
}) => ({
  id: p.id,
  tenantId: p.tenantId,
  bookingId: p.bookingId,
  status: p.status,
  amountCents: p.amountCents,
  refundedCents: p.refundedCents,
  retainedCents: p.retainedCents,
});

export function prismaWebhookStore(): WebhookStore<Tx> {
  return {
    run: (fn) => db.$transaction(fn, { timeout: 15_000, maxWait: 10_000 }),
    markEvent: async (tx, e) => {
      const r = await tx.stripeEvent.createMany({ data: [{ id: e.id, type: e.type, account: e.account }], skipDuplicates: true });
      return r.count === 1;
    },
    tenantByAccount: (tx, accountId) => tx.tenant.findFirst({ where: { stripeAccountId: accountId }, select: { id: true, rentalMode: true } }),
    // Η γραμμή πληρωμής ΚΛΕΙΔΩΝΕΤΑΙ (FOR UPDATE): webhook και εφεδρικός έλεγχος
    // σειριοποιούνται, ο δεύτερος βρίσκει PAID → noop (καμία διπλή εγγραφή).
    paymentBySession: async (tx, tenantId, sessionId) => {
      await tx.$queryRaw`SELECT "id" FROM "booking_payments" WHERE "tenantId" = ${tenantId} AND "stripeCheckoutSessionId" = ${sessionId} FOR UPDATE`;
      const p = await tx.bookingPayment.findFirst({ where: { tenantId, stripeCheckoutSessionId: sessionId } });
      return p && toWebhookPayment(p);
    },
    paymentByIntent: async (tx, tenantId, intent) => {
      await tx.$queryRaw`SELECT "id" FROM "booking_payments" WHERE "tenantId" = ${tenantId} AND "stripePaymentIntentId" = ${intent} FOR UPDATE`;
      const p = await tx.bookingPayment.findFirst({ where: { tenantId, stripePaymentIntentId: intent } });
      return p && toWebhookPayment(p);
    },
    booking: (tx, tenantId, id) =>
      // rentalMode: από την εταιρία του event (το συμπληρώνει το handleConnectEvent).
      tx.booking
        .findFirst({ where: { id, tenantId }, select: { id: true, tenantId: true, vehicleId: true, status: true, paymentStatus: true } })
        .then((b) => b && { ...b, rentalMode: "" }),
    applyTransition: async (tx, b, p, t: Transition) => {
      await tx.booking.update({
        where: { id: b.id },
        data: {
          paymentStatus: t.booking.paymentStatus,
          ...(t.booking.status ? { status: t.booking.status } : {}),
          ...(t.booking.cancelReasonCode ? { cancelReasonCode: t.booking.cancelReasonCode } : {}),
          ...(t.booking.clearExpiry ? { paymentExpiresAt: null } : {}),
        },
      });
      await tx.bookingPayment.update({
        where: { id: p.id },
        data: {
          status: t.payment.status,
          ...(t.payment.refundedCents !== undefined ? { refundedCents: t.payment.refundedCents } : {}),
          ...(t.payment.retainedCents !== undefined ? { retainedCents: t.payment.retainedCents } : {}),
          ...(t.payment.paidAt ? { paidAt: new Date() } : {}),
          ...(t.payment.paymentIntentId ? { stripePaymentIntentId: t.payment.paymentIntentId } : {}),
        },
      });
      if (t.booking.status === "CONFIRMED") await syncVehicleStatus(b.vehicleId, b.tenantId, tx);
      if (t.payment.status === "PAID") {
        const row = await tx.booking.findUnique({ where: { id: b.id }, select: { publicCode: true, bookingNumber: true } });
        await tx.notification.create({
          data: {
            tenantId: b.tenantId,
            type: "BOOKING_NEW",
            title: t.needsRefund ? "Πληρωμή σε ακυρωμένη κράτηση — θέλει επιστροφή ή απόφαση" : "Πληρώθηκε online κράτηση",
            message: `${row?.publicCode ?? row?.bookingNumber ?? ""} · ${(p.amountCents / 100).toFixed(2).replace(".", ",")} €`,
            link: `/dashboard/bookings?booking=${b.id}`,
          },
        });
      }
    },
    updateAccount: async (tx, tenantId, flags) => {
      await tx.tenant.update({ where: { id: tenantId }, data: flags });
    },
  };
}

/* ─────────────────────────────────────────────
   Λογαριασμός Connect
   ───────────────────────────────────────────── */

/** Ξαναδιαβάζει την κατάσταση από το Stripe (όταν ανοίγει η καρτέλα). Σε σφάλμα κρατά την αποθηκευμένη. */
export async function refreshAccount(companyId: string, accountId: string) {
  try {
    const a = await stripe().accounts.retrieve(accountId);
    const flags = accountFlags(a);
    await db.tenant.update({ where: { id: companyId }, data: flags });
    return flags;
  } catch (e) {
    console.error(`[FleetPro] Stripe account: ${stripeErrorCode(e)}`);
    return null;
  }
}

export interface RefundOutcome {
  ok: boolean;
  status: number;
  message?: string;
}

/** Επιστροφή χρημάτων στον λογαριασμό της εταιρίας + ιστορικό. */
export async function refundPayment(opts: {
  tenantId: string;
  userId: string;
  accountId: string;
  payment: {
    id: string;
    stripePaymentIntentId: string | null;
    amountCents: number;
    refundedCents: number;
    retainedCents: number;
    applicationFeeCents: number;
    refunds: unknown;
    bookingId: string;
  };
  amountCents: number;
}): Promise<RefundOutcome> {
  const { payment } = opts;
  if (!payment.stripePaymentIntentId) return { ok: false, status: 400, message: "no_intent" };
  let refund: Stripe.Refund;
  try {
    refund = await stripe().refunds.create(
      {
        payment_intent: payment.stripePaymentIntentId,
        amount: opts.amountCents,
        metadata: { bookingId: payment.bookingId, tenantId: opts.tenantId },
        // Η προμήθεια της πλατφόρμας επιστρέφεται αναλογικά μαζί με την επιστροφή.
        ...(payment.applicationFeeCents > 0 ? { refund_application_fee: true } : {}),
      },
      { stripeAccount: opts.accountId, idempotencyKey: `fleetpro-refund-${payment.id}-${payment.refundedCents}-${opts.amountCents}` }
    );
  } catch (e) {
    console.error(`[FleetPro] Stripe refund: ${stripeErrorCode(e)}`);
    return { ok: false, status: 502 };
  }
  // Η εγγραφή από την ΤΡΕΧΟΥΣΑ γραμμή, κλειδωμένη: ταυτόχρονη επιστροφή (ή το
  // webhook charge.refunded) δεν χάνεται.
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "booking_payments" WHERE "id" = ${payment.id} AND "tenantId" = ${opts.tenantId} FOR UPDATE`;
    const fresh = await tx.bookingPayment.findFirst({
      where: { id: payment.id, tenantId: opts.tenantId },
      select: { status: true, amountCents: true, refundedCents: true, retainedCents: true, refunds: true },
    });
    if (!fresh) return;
    const next = refundRowAfter(fresh, opts.amountCents);
    const history = Array.isArray(fresh.refunds) ? fresh.refunds : [];
    await tx.bookingPayment.update({
      where: { id: payment.id },
      data: {
        ...next,
        refunds: [...history, { id: refund.id, amountCents: opts.amountCents, at: new Date().toISOString(), userId: opts.userId }],
      },
    });
    await tx.booking.updateMany({ where: { id: payment.bookingId, tenantId: opts.tenantId }, data: { paymentStatus: next.status } });
  });
  return { ok: true, status: 200 };
}

/* ─────────────────────────────────────────────
   Εφεδρικός έλεγχος πληρωμής (χωρίς webhook)
   ───────────────────────────────────────────── */

export type PaymentCheckResult = WebhookOutcome | "rate_limited" | "not_checkable" | "not_ready" | "stripe_error";

/**
 * Ρωτά το Stripe για την πιο πρόσφατη session μιας online κράτησης ΤΗΣ ΕΤΑΙΡΙΑΣ
 * και, αν πληρώθηκε, περνά από την ΙΔΙΑ μετάβαση με το webhook. Όριο 1 ανά 10΄΄
 * ανά κράτηση. Η session ΜΟΝΟ από το booking_payments (ποτέ από URL).
 */
export async function checkBookingPayment(tenantId: string, bookingId: string, now = new Date()): Promise<PaymentCheckResult> {
  if (!stripeReady()) return "not_ready";
  const payment = await db.bookingPayment.findFirst({
    where: { tenantId, bookingId },
    orderBy: { createdAt: "desc" },
    select: { stripeCheckoutSessionId: true, stripeAccountId: true, status: true },
  });
  if (!payment || payment.status === "PAID" || payment.status === "PARTIALLY_REFUNDED" || payment.status === "REFUNDED") return "not_checkable";
  if (!(await hitLimit(dbCounterStore, LIMITS.paymentCheckPerBooking, `${tenantId}|${bookingId}`, now))) return "rate_limited";
  try {
    return await checkSessionNow(
      {
        tenantId,
        payment,
        retrieve: async (id, account) =>
          (await stripe().checkout.sessions.retrieve(id, {}, { stripeAccount: account })) as unknown as Record<string, unknown>,
      },
      prismaWebhookStore()
    );
  } catch (e) {
    console.error(`[FleetPro] Stripe payment check: ${stripeErrorCode(e)}`);
    return "stripe_error";
  }
}

/* ─────────────────────────────────────────────
   «Το υπόλοιπο κρατείται» (χρέωση ακύρωσης)
   ───────────────────────────────────────────── */

export async function retainPayment(opts: {
  tenantId: string;
  userId: string;
  paymentId: string;
  bookingId: string;
  retainedCents: number;
  addedCents: number;
  note: string | null;
  /** Όπως διαβάστηκαν — η εγγραφή γίνεται ΜΟΝΟ αν δεν άλλαξαν στο μεταξύ. */
  readRefundedCents: number;
  readRetainedCents: number;
}): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.bookingPayment.updateMany({
      // Ίδια εταιρία, και ΜΟΝΟ αν η πληρωμή είναι όπως τη διαβάσαμε (ταυτόχρονη επιστροφή → καμία αλλαγή).
      where: retainWhere({
        id: opts.paymentId,
        tenantId: opts.tenantId,
        bookingId: opts.bookingId,
        refundedCents: opts.readRefundedCents,
        retainedCents: opts.readRetainedCents,
      }),
      data: { retainedCents: opts.retainedCents, retainedAt: new Date(), retainedNote: opts.note, retainedBy: opts.userId },
    });
    if (r.count === 0) return false;
    await tx.activityLog.create({
      data: {
        tenantId: opts.tenantId,
        userId: opts.userId,
        action: "booking.retain",
        entity: "Booking",
        entityId: opts.bookingId,
        newData: { retainedCents: opts.retainedCents, addedCents: opts.addedCents, note: opts.note },
      },
    });
    return true;
  });
}
