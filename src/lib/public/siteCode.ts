// src/lib/public/siteCode.ts
// Εκπτωτικός κωδικός στη φόρμα κράτησης του δημόσιου site — ΚΑΘΑΡΗ λογική
// (χωρίς db· τα δεδομένα τα φέρνει ο καλών: siteCodeServer.ts).
//
// · ΜΟΝΟ κωδικοί της εταιρίας του site (το ερώτημα φιλτράρει με tenantId).
// · Κωδικός ΣΥΝΕΡΓΑΤΗ (createdById = PARTNER της ίδιας εταιρίας): ΜΟΝΟ ποσοστό,
//   ≤ το ΤΡΕΧΟΝ ποσοστό προμήθειας του, ενεργός συνεργάτης. Η έκπτωση
//   υπολογίζεται στην ΙΔΙΑ βάση με την προμήθεια (commission.ts →
//   partnerCodeDiscountCents) και αφαιρείται από την προμήθεια του
//   (bookingCommission): η εταιρία παίρνει ό,τι και χωρίς κωδικό.
// · Κωδικός της ΕΤΑΙΡΙΑΣ (χωρίς δημιουργό ή από Διαχειριστή/προσωπικό): όπως
//   στο dashboard (ποσοστό ή ποσό πάνω στο σύνολο, ακέραιο €), καμία αλλαγή
//   σε προμήθεια.
// · Μπαίνει ΠΑΝΩ στο σύνολο της quote() (όπως ο κωδικός του dashboard): οι
//   προσφορές του site (η μεγαλύτερη σε €) ΔΕΝ αλλάζουν.
// · Ο πελάτης βλέπει ΜΟΝΟ γενικά μηνύματα — ποτέ συνεργάτη ή προμήθειες.

import { partnerCodeDiscountCents, type PartnerCodeShare } from "../commission";
import { codeAmountEuros } from "../discountMath";
import { manualDiscountCents, toPriceBreakdown } from "../pricingBridge";
import type { QuoteResult } from "./pricing";

/** Ο κωδικός όπως τον διαβάζει ο server (μόνο της εταιρίας του site). */
export interface SiteCodeRecord {
  id: string;
  tenantId: string;
  code: string;
  type: string;
  value: number;
  target: string;
  minDays: number | null;
  minAmount: number | null;
  maxDiscount: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  usageLimit: number | null;
  usageCount: number;
  isActive: boolean;
  /** null = κωδικός της εταιρίας (ή παλιός). */
  creator: {
    id: string;
    role: string;
    tenantId: string | null;
    isActive: boolean;
    commissionRate: number;
    commissionOnRental: boolean;
    commissionOnExtras: boolean;
    commissionOnInsurance: boolean;
  } | null;
}

export type SiteCodeReason = "invalid" | "unavailable" | "not_yet" | "expired" | "exhausted" | "not_applicable";

/** Γενικά μηνύματα — ΙΔΙΑ για «δεν υπάρχει» και «άλλης εταιρίας». */
export const SITE_CODE_MESSAGES: Record<SiteCodeReason, { el: string; en: string }> = {
  invalid: { el: "Ο κωδικός δεν είναι έγκυρος.", en: "This code is not valid." },
  unavailable: { el: "Ο κωδικός δεν είναι πλέον διαθέσιμος.", en: "This code is no longer available." },
  not_yet: { el: "Ο κωδικός δεν ισχύει ακόμα.", en: "This code is not active yet." },
  expired: { el: "Ο κωδικός έχει λήξει.", en: "This code has expired." },
  exhausted: { el: "Ο κωδικός έχει ήδη χρησιμοποιηθεί όσες φορές επιτρέπεται.", en: "This code has reached its usage limit." },
  not_applicable: {
    el: "Ο κωδικός δεν ισχύει για αυτές τις ημερομηνίες ή αυτό το όχημα.",
    en: "This code is not valid for these dates or this vehicle.",
  },
};

/** Ο κωδικός όπως εφαρμόστηκε (για αποθήκευση στο priceQuote.manualDiscount). */
export interface AppliedSiteCode {
  discountId: string;
  code: string;
  /** Η έκπτωση σε cents (ακέραιο €). */
  cents: number;
  /** null = κωδικός της εταιρίας· αλλιώς ποιος συνεργάτης «πληρώνει» την έκπτωση. */
  partner: PartnerCodeShare | null;
}

export type SiteCodeOutcome = { ok: true; applied: AppliedSiteCode } | { ok: false; reason: SiteCodeReason };

/** Κανονική μορφή κωδικού (κεφαλαία)· null = δεν μπορεί να είναι κωδικός. */
export function normalizeSiteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(c) ? c : null;
}

/**
 * Ισχύει ο κωδικός για αυτή την τιμή (quote) τώρα; Καθαρή συνάρτηση — την
 * καλούν ΚΑΙ η «Εφαρμογή» ΚΑΙ η υποβολή (ξανά, μέσα στο κλείδωμα, με νέα
 * ανάγνωση του κωδικού και του συνεργάτη).
 */
export function evaluateSiteCode(rec: SiteCodeRecord | null, q: QuoteResult, opts: { tenantId: string; now: Date }): SiteCodeOutcome {
  // Δεν υπάρχει / άλλης εταιρίας → ΙΔΙΑ απάντηση.
  if (!rec || rec.tenantId !== opts.tenantId) return { ok: false, reason: "invalid" };

  // ── Ο δημιουργός: συνεργάτης ή εταιρία ──
  let partner: PartnerCodeShare | null = null;
  const c = rec.creator;
  if (c) {
    if (c.tenantId !== opts.tenantId) return { ok: false, reason: "invalid" };
    if (c.role === "PARTNER") {
      // Ανενεργός συνεργάτης / σταθερό ποσό / ποσοστό πάνω από την ΤΡΕΧΟΥΣΑ
      // προμήθεια (π.χ. ο Διαχειριστής τη μείωσε): απόρριψη, ΟΧΙ σιωπηλό κόψιμο.
      if (!c.isActive || rec.type !== "PERCENTAGE") return { ok: false, reason: "unavailable" };
      const rate = Number(c.commissionRate);
      const pct = Number(rec.value);
      if (!(pct > 0) || !(rate > 0) || pct > rate + 1e-9) return { ok: false, reason: "unavailable" };
      partner = {
        userId: c.id,
        percent: pct,
        onRental: c.commissionOnRental,
        onExtras: c.commissionOnExtras,
        onInsurance: c.commissionOnInsurance,
        maxDiscount: rec.maxDiscount,
      };
    }
  }

  // ── Ισχύς (ίδια σειρά με το dashboard) ──
  if (!rec.isActive) return { ok: false, reason: "unavailable" };
  if (rec.validFrom && rec.validFrom > opts.now) return { ok: false, reason: "not_yet" };
  if (rec.validUntil && rec.validUntil < opts.now) return { ok: false, reason: "expired" };
  if (rec.usageLimit !== null && rec.usageCount >= rec.usageLimit) return { ok: false, reason: "exhausted" };
  // Στο site ΜΟΝΟ γενικοί κωδικοί: ο πελάτης δεν είναι συνδεδεμένος, άρα
  // κωδικός «δεμένος σε πελάτη» δεν μπορεί να ελεγχθεί.
  if (rec.target !== "ALL") return { ok: false, reason: "not_applicable" };
  if (rec.minDays && q.days < rec.minDays) return { ok: false, reason: "not_applicable" };
  const baseEuros = q.totalCents / 100;
  if (rec.minAmount && baseEuros < rec.minAmount) return { ok: false, reason: "not_applicable" };

  // ── Το ποσό ──
  let cents: number;
  if (partner) {
    const b = toPriceBreakdown(q);
    cents = partnerCodeDiscountCents(
      { subtotal: b.subtotal, extrasTotal: b.extrasTotal, insuranceCost: b.insuranceCost },
      partner,
      q.totalCents
    );
  } else {
    cents = manualDiscountCents(codeAmountEuros(rec, baseEuros), q.totalCents);
  }
  if (cents <= 0) return { ok: false, reason: "not_applicable" };
  return { ok: true, applied: { discountId: rec.id, code: rec.code, cents, partner } };
}

/** Η γραμμή του κωδικού στην ανάλυση τιμής (ίδια σε φόρμα, σελίδα κράτησης, PDF). */
export const codeLineLabel = (code: string | null) =>
  code
    ? { el: `Εκπτωτικός κωδικός · ${code}`, en: `Discount code · ${code}` }
    : { el: "Έκπτωση", en: "Discount" };

/** Ο ΦΠΑ που περιέχεται σε ένα σύνολο (ΙΔΙΟΣ τύπος με την quote()). */
export function vatIncludedCents(totalCents: number, vatPercent: number): number {
  const vat = Math.max(0, vatPercent);
  return totalCents - Math.round(totalCents / (1 + vat / 100));
}
