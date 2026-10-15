// src/lib/pricingBridge.ts
// Από την quote() (cents, γραμμές) στα πεδία που κρατούν κράτηση, συμβόλαιο
// και τιμολόγιο (€, subtotal / extrasTotal / insuranceCost / discountAmount /
// total) — καθαρή λογική, χωρίς db. ΔΕΝ υπολογίζει τιμή: μόνο ταξινομεί τις
// γραμμές της quote() και προσθέτει την (στρογγυλοποιημένη) έκπτωση κωδικού.
//
//   subtotal      = ενοίκιο + χρεώσεις τοποθεσίας/δρομολογίου/εκτός ωραρίου/
//                   ηλικίας + στρογγυλοποίηση
//   extrasTotal   = πρόσθετα · insuranceCost = ασφάλεια
//   discountAmount= έκπτωση/προσφορά της quote() + κωδικός/χειροκίνητη έκπτωση
//   total         = ΑΚΡΙΒΩΣ subtotal + extras + ασφάλεια − έκπτωση (ακέραιο €)

import { fromCents, roundToEuro } from "./public/money";
import type { QuoteResult } from "./public/pricing";
import { textFor } from "./public/text";
import type { PriceBreakdown, PricedExtraLine } from "./pricing";

/** Η ανάλυση που αποθηκεύεται στην κράτηση (bookings."priceQuote", JSONB). */
export interface StoredQuote {
  version: 1;
  /** ISO — πότε υπολογίστηκε. */
  at: string;
  /** Οι γραμμές της quote() (cents) + η έκπτωση κωδικού, αν υπάρχει. */
  quote: Pick<QuoteResult, "days" | "lines" | "listTotalCents" | "discountCents" | "discountBadge" | "totalCents" | "vatCents" | "avgDailyCents" | "depositCents" | "excessCents" | "errors">;
  manualDiscount: { cents: number; code: string | null } | null;
  /** Τελικό σύνολο της κράτησης (cents) — πριν από τυχόν χειροκίνητο ενοίκιο. */
  totalCents: number;
  /** false = λείπει τιμή στις ρυθμίσεις (μόνο χειροκίνητη). */
  autoPrice: boolean;
}

export type PriceMode = "AUTO" | "MANUAL";

const sum = (q: QuoteResult, kinds: string[]) => q.lines.filter((l) => kinds.includes(l.kind)).reduce((s, l) => s + l.totalCents, 0);

const RENTAL_KINDS = ["rental", "location", "delivery", "collection", "one_way", "after_hours", "driver_age", "rounding"];

/**
 * Η έκπτωση κωδικού/χειροκίνητη σε cents, στρογγυλοποιημένη σε ακέραιο €
 * (ίδιος κανόνας) και ποτέ πάνω από το σύνολο.
 */
export const manualDiscountCents = (euros: number, totalCents: number) =>
  Math.min(Math.max(0, roundToEuro(Math.round(euros * 100))), totalCents);

export function toPriceBreakdown(
  q: QuoteResult,
  opts: { manualDiscountCents?: number; extraMeta?: Map<string, { chargeType: string; type: string }> } = {}
): PriceBreakdown {
  const manual = Math.max(0, opts.manualDiscountCents ?? 0);
  const subtotal = sum(q, RENTAL_KINDS);
  const extrasTotal = sum(q, ["extra"]);
  const insuranceCost = sum(q, ["insurance"]);
  const discount = Math.abs(sum(q, ["discount"])) + manual;
  const total = Math.max(0, subtotal + extrasTotal + insuranceCost - discount);
  const rental = sum(q, ["rental"]);
  const lines: PricedExtraLine[] = q.lines
    .filter((l) => l.kind === "extra" || l.kind === "insurance")
    .map((l) => ({
      id: l.refId ?? "",
      name: textFor(l.label, "el"),
      price: fromCents(l.unitCents),
      chargeType: opts.extraMeta?.get(l.refId ?? "")?.chargeType ?? "ONE_OFF",
      type: l.kind === "insurance" ? "INSURANCE" : "EXTRA",
      lineTotal: fromCents(l.totalCents),
    }));
  return {
    totalDays: q.days,
    dailyRate: fromCents(Math.round(rental / Math.max(1, q.days))),
    subtotal: fromCents(subtotal),
    extrasTotal: fromCents(extrasTotal),
    insuranceCost: fromCents(insuranceCost),
    beforeDiscount: fromCents(subtotal + extrasTotal + insuranceCost),
    discountAmount: fromCents(discount),
    exactTotal: fromCents(total),
    roundingAdjustment: 0,
    total: fromCents(total),
    lines,
  };
}

export function toStoredQuote(
  q: QuoteResult,
  manual: { cents: number; code: string | null } | null,
  autoPrice: boolean,
  now = new Date()
): StoredQuote {
  return {
    version: 1,
    at: now.toISOString(),
    quote: {
      days: q.days,
      lines: q.lines,
      listTotalCents: q.listTotalCents,
      discountCents: q.discountCents,
      discountBadge: q.discountBadge,
      totalCents: q.totalCents,
      vatCents: q.vatCents,
      avgDailyCents: q.avgDailyCents,
      depositCents: q.depositCents,
      excessCents: q.excessCents,
      errors: q.errors,
    },
    manualDiscount: manual && manual.cents > 0 ? manual : null,
    totalCents: Math.max(0, q.totalCents - (manual?.cents ?? 0)),
    autoPrice,
  };
}
