// src/lib/contractPayment.ts
// Πληρωμή ενοικίου του συμβολαίου με κάρτα μέσω Stripe Connect (Checkout:
// link + QR στο κινητό του πελάτη). Server-only. Ξαναχρησιμοποιεί ΟΛΟ το
// μηχανισμό του PR #29: booking_payments (purpose = CONTRACT), το ίδιο
// webhook / εφεδρικό έλεγχο (checkSessionNow) και την ίδια επιστροφή.
//
// · Εταιρία/δικαιώματα: το συμβόλαιο ΜΟΝΟ με contractScope(viewer).
// · Ποσό ΜΟΝΟ από τη βάση (contractPaymentCore.contractAmountDueCents).
// · Κανένα στοιχείο κάρτας δεν γράφεται πουθενά — μόνο το Stripe τα βλέπει.

import { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import QRCode from "qrcode";
import { db } from "./db";
import type { Viewer } from "./authz";
import { contractScope } from "./contractForm";
import { stripe, stripeErrorCode, stripeReady } from "./stripeConnect";
import { accountStatus, applicationFeeCents } from "./public/payments";
import { checkSessionNow, type WebhookOutcome } from "./public/paymentWebhook";
import { prismaWebhookStore } from "./public/paymentServer";
import { hitLimit, LIMITS } from "./public/rateLimit";
import { dbCounterStore } from "./public/rateLimitStore";
import {
  CONTRACT_CHECKOUT_TTL_MINUTES,
  CONTRACT_PAY_MSG,
  checkOpenPayment,
  completionBlock,
  contractAmountDueCents,
  contractCardMode,
  contractPayStatus,
  reusableCheckout,
  type ContractCardMode,
  type ContractPayStatus,
} from "./contractPaymentCore";

const PAYMENT_SELECT = {
  id: true,
  status: true,
  amountCents: true,
  refundedCents: true,
  retainedCents: true,
  checkoutUrl: true,
  expiresAt: true,
  paidAt: true,
  createdAt: true,
  stripeCheckoutSessionId: true,
  stripeAccountId: true,
} as const;

const CONTEXT_SELECT = {
  id: true,
  tenantId: true,
  bookingId: true,
  contractNumber: true,
  status: true,
  paymentMethod: true,
  paymentCard: true,
  cardNumberEnc: true,
  booking: {
    select: {
      total: true,
      customer: { select: { email: true } },
      payments: { orderBy: { createdAt: "desc" as const }, select: { ...PAYMENT_SELECT, purpose: true } },
    },
  },
  tenant: {
    select: {
      name: true,
      platformFeeBps: true,
      stripeAccountId: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  },
} satisfies Prisma.ContractSelect;

type ContextRow = Prisma.ContractGetPayload<{ select: typeof CONTEXT_SELECT }>;

/** Ό,τι χρειάζεται για να αποφασιστεί τρόπος, ποσό και αν ολοκληρώνεται. ΜΟΝΟ με contractScope. */
export async function loadContractPaymentContext(viewer: Viewer, contractId: string) {
  const c = await db.contract.findFirst({ where: { ...contractScope(viewer), id: contractId }, select: CONTEXT_SELECT });
  return c ? contextOf(c) : null;
}

/** Υπάρχουν ήδη στοιχεία κάρτας ΠΛΗΡΩΜΗΣ (παλιός τρόπος); */
export function hasLegacyPaymentCard(c: { paymentCard: unknown; cardNumberEnc: string | null }): boolean {
  if (c.paymentCard && typeof c.paymentCard === "object") return true;
  if (!c.cardNumberEnc) return false;
  try {
    const o = JSON.parse(c.cardNumberEnc) as Record<string, unknown>;
    return typeof o?.payment === "string" && o.payment.length > 0;
  } catch {
    return false;
  }
}

function contextOf(c: ContextRow) {
  const site = c.booking.payments.filter((p) => p.purpose !== "CONTRACT");
  const contractPayments = c.booking.payments.filter((p) => p.purpose === "CONTRACT");
  const stripeActive = stripeReady() && !!c.tenant.stripeAccountId && accountStatus(c.tenant) === "ACTIVE";
  const mode = contractCardMode({
    paymentMethod: c.paymentMethod,
    hasLegacyCard: hasLegacyPaymentCard(c),
    hasContractPayment: contractPayments.length > 0,
    stripeActive,
  });
  return {
    contract: c,
    mode,
    stripeActive,
    dueCents: contractAmountDueCents(c.booking.total, site),
    contractPayments,
    latest: contractPayments[0] ?? null,
  };
}

export type ContractPaymentContext = ReturnType<typeof contextOf>;

/** Ενεργός λογαριασμός Connect + κλειδιά στον server (για το νέο συμβόλαιο). */
export async function tenantStripeActive(tenantId: string): Promise<boolean> {
  if (!stripeReady()) return false;
  const t = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeAccountId: true, stripeChargesEnabled: true, stripePayoutsEnabled: true, stripeDetailsSubmitted: true },
  });
  return !!t?.stripeAccountId && accountStatus(t) === "ACTIVE";
}

/** Τρόπος κάρτας για ένα συμβόλαιο με (ίσως) νέο τρόπο πληρωμής — για PATCH/δημιουργία. */
export async function cardModeFor(
  tenantId: string,
  opts: { contractId?: string; bookingId?: string; paymentMethod: string | null; paymentCard?: unknown; cardNumberEnc?: string | null }
): Promise<ContractCardMode | null> {
  if (opts.paymentMethod !== "CARD") return null;
  const [tenant, contractPayments] = await Promise.all([
    db.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeAccountId: true, stripeChargesEnabled: true, stripePayoutsEnabled: true, stripeDetailsSubmitted: true },
    }),
    opts.bookingId
      ? db.bookingPayment.count({ where: { tenantId, bookingId: opts.bookingId, purpose: "CONTRACT" } })
      : Promise.resolve(0),
  ]);
  return contractCardMode({
    paymentMethod: opts.paymentMethod,
    hasLegacyCard: hasLegacyPaymentCard({ paymentCard: opts.paymentCard ?? null, cardNumberEnc: opts.cardNumberEnc ?? null }),
    hasContractPayment: contractPayments > 0,
    stripeActive: stripeReady() && !!tenant?.stripeAccountId && !!tenant && accountStatus(tenant) === "ACTIVE",
  });
}

/** Γιατί δεν ολοκληρώνεται (null = ολοκληρώνεται). */
export const completionBlockOf = (ctx: ContractPaymentContext) =>
  completionBlock({ mode: ctx.mode, dueCents: ctx.dueCents, contractPayments: ctx.contractPayments });

export interface ContractPaymentDTO {
  /** null = ο τρόπος πληρωμής δεν είναι «Κάρτα». */
  mode: ContractCardMode | null;
  stripeActive: boolean;
  dueCents: number;
  status: ContractPayStatus;
  payment: {
    amountCents: number;
    refundedCents: number;
    paidAt: string | null;
    expiresAt: string | null;
    /** ΜΟΝΟ όσο το link ισχύει. */
    url: string | null;
    qrSvg: string | null;
  } | null;
  /** Γιατί δεν βγαίνει link (null = βγαίνει). */
  openBlock: string | null;
  completionBlock: string | null;
}

export async function toContractPaymentDTO(ctx: ContractPaymentContext, now = new Date()): Promise<ContractPaymentDTO> {
  const p = ctx.latest;
  const status = contractPayStatus(p, now);
  const url = status === "AWAITING" && p?.checkoutUrl ? p.checkoutUrl : null;
  const open = checkOpenPayment({
    status: ctx.contract.status,
    mode: ctx.mode,
    stripeActive: ctx.stripeActive,
    dueCents: ctx.dueCents,
    contractPayments: ctx.contractPayments,
  });
  return {
    mode: ctx.mode,
    stripeActive: ctx.stripeActive,
    dueCents: ctx.dueCents,
    status,
    payment: p
      ? {
          amountCents: p.amountCents,
          refundedCents: p.refundedCents,
          paidAt: p.paidAt?.toISOString() ?? null,
          expiresAt: p.expiresAt?.toISOString() ?? null,
          url,
          qrSvg: url ? await qrSvg(url) : null,
        }
      : null,
    openBlock: open.ok ? null : open.message,
    completionBlock: completionBlockOf(ctx),
  };
}

async function qrSvg(url: string): Promise<string | null> {
  try {
    return await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  } catch {
    console.error("[FleetPro] QR πληρωμής: αποτυχία δημιουργίας");
    return null;
  }
}

export type OpenResult = { ok: true } | { ok: false; status: 400 | 409 | 502; message: string };

/**
 * Link πληρωμής (Checkout) για το ενοίκιο. Ανοιχτό link με ίδιο ποσό →
 * ξαναδίνεται (καμία νέα session). Δύο ταυτόχρονα πατήματα → ίδιο
 * idempotency key → ίδια session → μία γραμμή (unique session id).
 */
export async function openContractCheckout(ctx: ContractPaymentContext, origin: string, now = new Date()): Promise<OpenResult> {
  if (!stripeReady()) return { ok: false, status: 400, message: CONTRACT_PAY_MSG.notConfigured };
  const check = checkOpenPayment({
    status: ctx.contract.status,
    mode: ctx.mode,
    stripeActive: ctx.stripeActive,
    dueCents: ctx.dueCents,
    contractPayments: ctx.contractPayments,
  });
  if (!check.ok) return check;
  const c = ctx.contract;
  const amount = ctx.dueCents;
  if (reusableCheckout(ctx.contractPayments, amount, now)) return { ok: true };

  const account = c.tenant.stripeAccountId!;
  const fee = applicationFeeCents(amount, c.tenant.platformFeeBps);
  const expiresAt = new Date(now.getTime() + CONTRACT_CHECKOUT_TTL_MINUTES * 60_000);
  const base = origin.replace(/\/+$/, "");
  const metadata = { bookingId: c.bookingId, tenantId: c.tenantId, contractId: c.id, purpose: "CONTRACT" };

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: amount,
              product_data: { name: `Ενοίκιο / Rental ${c.contractNumber} · ${c.tenant.name}`.slice(0, 250) },
            },
          },
        ],
        ...(c.booking.customer.email ? { customer_email: c.booking.customer.email } : {}),
        locale: "auto",
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        // Η επιστροφή ΔΕΝ επιβεβαιώνει τίποτα — μόνο ευχαριστεί. «Πληρώθηκε» μόνο από webhook/έλεγχο.
        success_url: `${base}/pay/done`,
        cancel_url: `${base}/pay/cancelled`,
        client_reference_id: c.bookingId,
        metadata,
        payment_intent_data: {
          metadata,
          description: `${c.contractNumber} · ${c.tenant.name}`.slice(0, 250),
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
        },
      },
      {
        stripeAccount: account,
        // Ίδιο συμβόλαιο + ίδιο ποσό + ίδια «γενιά» → ίδια session.
        idempotencyKey: `fleetpro-contract-${c.id}-${amount}-${ctx.contractPayments.length}`,
        timeout: 8_000,
        maxNetworkRetries: 1,
      }
    );
  } catch (e) {
    console.error(`[FleetPro] Stripe contract checkout: ${stripeErrorCode(e)}`);
    return { ok: false, status: 502, message: CONTRACT_PAY_MSG.stripe };
  }
  if (!session.url) return { ok: false, status: 502, message: CONTRACT_PAY_MSG.stripe };

  try {
    await db.bookingPayment.create({
      data: {
        tenantId: c.tenantId,
        bookingId: c.bookingId,
        purpose: "CONTRACT",
        stripeAccountId: account,
        stripeCheckoutSessionId: session.id,
        checkoutUrl: session.url,
        amountCents: amount,
        applicationFeeCents: fee,
        currency: "eur",
        status: "OPEN",
        expiresAt,
      },
    });
  } catch (e) {
    // Ταυτόχρονο πάτημα: η ίδια session γράφτηκε ήδη — κανένα πρόβλημα.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
  return { ok: true };
}

export type ContractCheckResult = WebhookOutcome | "rate_limited" | "not_checkable" | "not_ready" | "stripe_error";

/**
 * «Έλεγχος πληρωμής στο Stripe» για το συμβόλαιο: ίδια οδός με το webhook
 * (checkSessionNow), session ΜΟΝΟ από το booking_payments της εταιρίας.
 */
export async function checkContractPayment(ctx: ContractPaymentContext, now = new Date()): Promise<ContractCheckResult> {
  if (!stripeReady()) return "not_ready";
  const p = ctx.latest;
  if (!p || p.status !== "OPEN") return "not_checkable";
  const c = ctx.contract;
  if (!(await hitLimit(dbCounterStore, LIMITS.paymentCheckPerBooking, `${c.tenantId}|contract|${c.id}`, now))) return "rate_limited";
  try {
    return await checkSessionNow(
      {
        tenantId: c.tenantId,
        payment: { stripeCheckoutSessionId: p.stripeCheckoutSessionId, stripeAccountId: p.stripeAccountId },
        retrieve: async (id, account) =>
          (await stripe().checkout.sessions.retrieve(id, {}, { stripeAccount: account })) as unknown as Record<string, unknown>,
      },
      prismaWebhookStore()
    );
  } catch (e) {
    console.error(`[FleetPro] Stripe contract payment check: ${stripeErrorCode(e)}`);
    return "stripe_error";
  }
}
