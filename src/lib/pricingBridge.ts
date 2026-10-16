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
import type { InsuranceSnapshot, QuoteResult } from "./public/pricing";
import { textFor, type LocalizedText } from "./public/text";
import type { PriceBreakdown, PricedExtraLine } from "./pricing";

/** Η ανάλυση που αποθηκεύεται στην κράτηση (bookings."priceQuote", JSONB). */
export interface StoredQuote {
  version: 1;
  /** ISO — πότε υπολογίστηκε. */
  at: string;
  /** Οι γραμμές της quote() (cents) + η έκπτωση κωδικού, αν υπάρχει. */
  quote: Pick<QuoteResult, "days" | "lines" | "listTotalCents" | "discountCents" | "discountBadge" | "totalCents" | "vatCents" | "avgDailyCents" | "depositCents" | "excessCents" | "errors"> & {
    /**
     * Το επίπεδο ασφάλειας ΟΠΩΣ ΗΤΑΝ (όνομα, τιμή, καλύψεις) — null = χωρίς
     * πρόσθετη ασφάλεια. Λείπει σε κρατήσεις πριν από το SQL 25.
     */
    insurance?: InsuranceSnapshot | null;
  };
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
      // Ασφάλεια: το σκέτο όνομα του επιπέδου (η γραμμή της quote() γράφει «Ασφάλεια · …»).
      name: l.kind === "insurance" && q.insurance && q.insurance.id === l.refId ? textFor(q.insurance.name, "el") : textFor(l.label, "el"),
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
      insurance: q.insurance ?? null,
    },
    manualDiscount: manual && manual.cents > 0 ? manual : null,
    totalCents: Math.max(0, q.totalCents - (manual?.cents ?? 0)),
    autoPrice,
  };
}

/**
 * Η χειροκίνητη έκπτωση από το αποθηκευμένο priceQuote: undefined = παλιά
 * κράτηση χωρίς priceQuote· null = καμία· αλλιώς { cents, code }.
 */
export function storedManualDiscount(priceQuote: unknown): { cents: number; code: string | null } | null | undefined {
  if (!priceQuote || typeof priceQuote !== "object" || Array.isArray(priceQuote)) return undefined;
  const q = priceQuote as { version?: unknown; manualDiscount?: unknown };
  if (q.version !== 1) return undefined;
  const m = q.manualDiscount;
  if (!m || typeof m !== "object") return null;
  const { cents, code } = m as { cents?: unknown; code?: unknown };
  const c = typeof cents === "number" && cents > 0 ? cents : 0;
  const k = typeof code === "string" && code.trim() ? code : null;
  return c > 0 || k ? { cents: c, code: k } : null;
}

/**
 * Το επίπεδο ασφάλειας από ένα αποθηκευμένο priceQuote (σελίδα πελάτη,
 * μήνυμα, dashboard) — ποτέ νέος υπολογισμός. null = χωρίς ασφάλεια ή παλιά
 * κράτηση· τότε, αν υπάρχει γραμμή ασφάλειας, μόνο το όνομά της.
 */
export function storedInsurance(priceQuote: unknown): { name: LocalizedText; coverages: LocalizedText[]; totalCents: number; excessCents: number | null } | null {
  if (!priceQuote || typeof priceQuote !== "object" || Array.isArray(priceQuote)) return null;
  const q = (priceQuote as { quote?: { insurance?: unknown; lines?: unknown } }).quote;
  if (!q || typeof q !== "object") return null;
  const ins = q.insurance as Partial<InsuranceSnapshot> | null | undefined;
  if (ins && typeof ins === "object" && ins.name && typeof ins.name === "object") {
    return {
      name: ins.name as LocalizedText,
      coverages: Array.isArray(ins.coverages) ? (ins.coverages as LocalizedText[]) : [],
      totalCents: typeof ins.totalCents === "number" ? ins.totalCents : 0,
      excessCents: typeof ins.excessCents === "number" ? ins.excessCents : null,
    };
  }
  const line = Array.isArray(q.lines)
    ? (q.lines as { kind?: string; label?: LocalizedText; totalCents?: number }[]).find((l) => l.kind === "insurance")
    : undefined;
  return line?.label ? { name: line.label, coverages: [], totalCents: line.totalCents ?? 0, excessCents: null } : null;
}
