// src/lib/contractPaymentCore.ts
// Πληρωμή ενοικίου του συμβολαίου με κάρτα μέσω Stripe Connect — ΚΑΘΑΡΗ
// λογική (για τα tests). Ο server (contractPayment.ts) δίνει τα δεδομένα.
//
// · Ποσό ΜΟΝΟ από τον server: το σύνολο της κράτησης (ίδιος υπολογισμός με το
//   price-preview/αποθήκευση του συμβολαίου) μείον ό,τι έχει ήδη πληρωθεί
//   online από το site για την ίδια κράτηση — ποτέ διπλή χρέωση.
// · «Πληρώθηκε» ΜΟΝΟ από το webhook (ή τον εφεδρικό έλεγχο του server στο
//   Stripe) — ποτέ από το redirect της επιστροφής.
// · Τρόπος κάρτας ανά συμβόλαιο:
//     STRIPE — ο πελάτης πληρώνει με link/QR· ΚΑΝΕΝΑ στοιχείο κάρτας δεν γράφεται.
//     MANUAL — ο παλιός τρόπος (μάρκα/λήξη/αριθμός): συμβόλαια που ΗΔΗ έχουν
//              στοιχεία κάρτας, ή εταιρία χωρίς ενεργό Stripe.

export type ContractCardMode = "STRIPE" | "MANUAL";

/** Κάτω από αυτό το Stripe δεν χρεώνει (0,50 €). */
export const MIN_CARD_CENTS = 50;

/** Πόσο ισχύει το link πληρωμής (το Stripe δέχεται έως 24 ώρες). */
export const CONTRACT_CHECKOUT_TTL_MINUTES = 23 * 60;

export const PAID_STATUSES = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

export const CONTRACT_PAY_MSG = {
  notCard: "Ο τρόπος πληρωμής του συμβολαίου δεν είναι «Κάρτα».",
  notSigned: "Το link πληρωμής βγαίνει μετά την υπογραφή του συμβολαίου (το ποσό κλειδώνει με την υπογραφή).",
  completed: "Το συμβόλαιο έχει ολοκληρωθεί.",
  manual: "Η εταιρία δεν έχει ενεργό λογαριασμό Stripe: η κάρτα καταχωρείται με τον παλιό τρόπο.",
  legacy: "Το συμβόλαιο έχει ήδη καταχωρημένα στοιχεία κάρτας (παλιός τρόπος).",
  nothingDue: "Δεν υπάρχει ποσό για πληρωμή με κάρτα (έχει ήδη πληρωθεί online).",
  alreadyPaid: "Η πληρωμή με κάρτα έχει ήδη γίνει.",
  stripe: "Το Stripe δεν απάντησε. Δοκιμάστε ξανά σε λίγο.",
  notConfigured: "Οι online πληρωμές δεν είναι ρυθμισμένες στον server.",
  completeBlocked: "Το συμβόλαιο ολοκληρώνεται μόνο αφού επιβεβαιωθεί η πληρωμή με κάρτα από το Stripe.",
  noCardData: "Με πληρωμή μέσω Stripe δεν καταχωρούνται στοιχεία κάρτας.",
} as const;

export interface PaymentRow {
  status: string;
  amountCents: number;
  refundedCents: number;
  retainedCents?: number;
  checkoutUrl?: string | null;
  expiresAt?: Date | null;
  paidAt?: Date | null;
  createdAt?: Date;
}

/** Ποιος τρόπος ισχύει για την κάρτα πληρωμής του συμβολαίου (null = ο τρόπος δεν είναι «Κάρτα»). */
export function contractCardMode(c: {
  paymentMethod: string | null;
  /** Υπάρχουν ήδη στοιχεία κάρτας πληρωμής (paymentCard ή κρυπτογραφημένος αριθμός). */
  hasLegacyCard: boolean;
  /** Υπάρχει ήδη πληρωμή συμβολαίου στο Stripe (μένει STRIPE ό,τι κι αν αλλάξει). */
  hasContractPayment: boolean;
  /** Λογαριασμός Connect ACTIVE και κλειδιά στον server. */
  stripeActive: boolean;
}): ContractCardMode | null {
  if (c.paymentMethod !== "CARD") return null;
  if (c.hasContractPayment) return "STRIPE";
  if (c.hasLegacyCard) return "MANUAL";
  return c.stripeActive ? "STRIPE" : "MANUAL";
}

/** Ό,τι πληρώθηκε καθαρά (μείον επιστροφές) από μια σειρά πληρωμών. */
export const netPaidCents = (rows: PaymentRow[]): number =>
  rows
    .filter((r) => (PAID_STATUSES as readonly string[]).includes(r.status))
    .reduce((sum, r) => sum + Math.max(0, r.amountCents - r.refundedCents), 0);

/**
 * Το ποσό που πληρώνεται με κάρτα στο συμβόλαιο (cents): σύνολο κράτησης −
 * ό,τι πληρώθηκε ήδη online από το site. Το σύνολο ΜΟΝΟ από τη βάση.
 */
export function contractAmountDueCents(bookingTotalEur: number | string | { toString(): string }, sitePayments: PaymentRow[]): number {
  const total = Math.round(Number(String(bookingTotalEur)) * 100);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, total - netPaidCents(sitePayments));
}

export type ContractPayStatus = "NONE" | "AWAITING" | "PAID" | "FAILED" | "EXPIRED" | "PARTIALLY_REFUNDED" | "REFUNDED";

/** Η κατάσταση που βλέπει ο υπάλληλος, από την πιο πρόσφατη πληρωμή συμβολαίου. */
export function contractPayStatus(p: PaymentRow | null | undefined, now: Date): ContractPayStatus {
  if (!p) return "NONE";
  switch (p.status) {
    case "OPEN":
      return p.expiresAt && p.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : "AWAITING";
    case "PAID":
    case "FAILED":
    case "EXPIRED":
    case "PARTIALLY_REFUNDED":
    case "REFUNDED":
      return p.status;
    default:
      return "NONE";
  }
}

/** Επιβεβαιωμένη (από webhook/Stripe) πληρωμή συμβολαίου; */
export const hasConfirmedPayment = (rows: PaymentRow[]): boolean =>
  rows.some((r) => (PAID_STATUSES as readonly string[]).includes(r.status));

/** Ανοιχτό link που μπορεί να ξαναδοθεί: ίδιο ποσό, δεν έληξε, έχει URL. */
export function reusableCheckout<T extends PaymentRow>(rows: T[], amountCents: number, now: Date): T | null {
  return (
    rows.find(
      (r) =>
        r.status === "OPEN" &&
        r.amountCents === amountCents &&
        !!r.checkoutUrl &&
        (!r.expiresAt || r.expiresAt.getTime() > now.getTime() + 60_000)
    ) ?? null
  );
}

/** Μπορεί να βγει (ή να ξαναδοθεί) link πληρωμής; */
export function checkOpenPayment(c: {
  status: string;
  mode: ContractCardMode | null;
  stripeActive: boolean;
  dueCents: number;
  contractPayments: PaymentRow[];
}): { ok: true } | { ok: false; status: 400 | 409; message: string } {
  if (c.mode === null) return { ok: false, status: 400, message: CONTRACT_PAY_MSG.notCard };
  if (c.status === "COMPLETED") return { ok: false, status: 409, message: CONTRACT_PAY_MSG.completed };
  if (c.mode === "MANUAL") return { ok: false, status: 400, message: CONTRACT_PAY_MSG.manual };
  if (!c.stripeActive) return { ok: false, status: 400, message: CONTRACT_PAY_MSG.manual };
  if (c.status !== "SIGNED") return { ok: false, status: 409, message: CONTRACT_PAY_MSG.notSigned };
  if (hasConfirmedPayment(c.contractPayments)) return { ok: false, status: 409, message: CONTRACT_PAY_MSG.alreadyPaid };
  if (c.dueCents < MIN_CARD_CENTS) return { ok: false, status: 400, message: CONTRACT_PAY_MSG.nothingDue };
  return { ok: true };
}

/**
 * Η ολοκλήρωση με κάρτα μέσω Stripe θέλει ΕΠΙΒΕΒΑΙΩΜΕΝΗ πληρωμή (webhook ή
 * έλεγχος του server στο Stripe). null = επιτρέπεται.
 */
export function completionBlock(c: {
  mode: ContractCardMode | null;
  dueCents: number;
  contractPayments: PaymentRow[];
}): string | null {
  if (c.mode !== "STRIPE") return null;
  if (hasConfirmedPayment(c.contractPayments)) return null;
  if (c.dueCents < MIN_CARD_CENTS) return null;
  return CONTRACT_PAY_MSG.completeBlocked;
}

/** Το PATCH/δημιουργία σε τρόπο STRIPE δεν δέχεται κανένα στοιχείο κάρτας πληρωμής. */
export function sendsPaymentCardData(patch: { paymentCard?: unknown; paymentCardNumber?: unknown }): boolean {
  return (patch.paymentCard !== undefined && patch.paymentCard !== null) ||
    (typeof patch.paymentCardNumber === "string" && patch.paymentCardNumber.length > 0);
}
