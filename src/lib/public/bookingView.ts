// src/lib/public/bookingView.ts
// Τι βλέπει ο browser στη φόρμα κράτησης — καθαρή λογική, ΜΟΝΟ δημόσια πεδία.

import { chargeTotalCents, type QuoteResult, type VehicleType } from "./pricing";
import { insuranceLevelsFor } from "./engine";
import type { QuoteContext } from "./server";
import { textFor } from "./text";
import { codeLineLabel, vatIncludedCents } from "./siteCode";

/** Η ανάλυση τιμής για τον browser (γραμμές + σύνολα, cents). */
export interface PublicQuote {
  ok: boolean;
  errors: { el: string; en: string }[];
  days: number;
  lines: { kind: string; label: { el?: string; en?: string }; qty: number; totalCents: number }[];
  totalCents: number;
  listTotalCents: number;
  vatCents: number;
  depositCents: number | null;
  excessCents: number | null;
}

/**
 * `code` = εκπτωτικός κωδικός που εφαρμόστηκε (ΜΟΝΟ κωδικός και ποσό — ποτέ
 * συνεργάτης/προμήθεια): γραμμή «Εκπτωτικός κωδικός · X», νέο σύνολο και ο
 * ΦΠΑ του (vatPercent της εταιρίας). Ίδια ποσά με την αποθήκευση της κράτησης.
 */
export function toPublicQuote(q: QuoteResult, code?: { code: string; cents: number } | null, vatPercent = 0): PublicQuote {
  const lines = q.lines.map((l) => ({ kind: l.kind, label: l.label, qty: l.qty, totalCents: l.totalCents }));
  if (code && code.cents > 0) {
    const totalCents = Math.max(0, q.totalCents - code.cents);
    return {
      ok: q.ok,
      errors: q.errors.map((e) => e.message),
      days: q.days,
      lines: [...lines, { kind: "code", label: codeLineLabel(code.code), qty: 1, totalCents: -code.cents }],
      totalCents,
      listTotalCents: q.listTotalCents,
      vatCents: vatIncludedCents(totalCents, vatPercent),
      depositCents: q.depositCents,
      excessCents: q.excessCents,
    };
  }
  return {
    ok: q.ok,
    errors: q.errors.map((e) => e.message),
    days: q.days,
    lines,
    totalCents: q.totalCents,
    listTotalCents: q.listTotalCents,
    vatCents: q.vatCents,
    depositCents: q.depositCents,
    excessCents: q.excessCents,
  };
}

/** Πρόσθετο που μπορεί να διαλέξει ο πελάτης (για τον τύπο οχήματος). */
export interface PublicExtraOption {
  id: string;
  kind: "EXTRA";
  name: string;
  priceCents: number;
  priceType: "per_day" | "per_rental";
  maxQuantity: number;
  maxTotalCents: number | null;
}

/** Τα ΠΡΟΣΘΕΤΑ (όχι ασφάλειες) για τον τύπο οχήματος — συμπεριφορά όπως πριν. */
export function extraOptions(ctx: QuoteContext, vehicleType: VehicleType, lang: string): PublicExtraOption[] {
  return ctx.extras
    .filter((e) => e.kind === "EXTRA" && e.isActive && (e.vehicleTypes.length === 0 || e.vehicleTypes.includes(vehicleType)))
    .map((e) => ({
      id: e.id,
      kind: "EXTRA" as const,
      name: textFor(e.name, lang),
      priceCents: e.priceCents,
      priceType: e.priceType,
      maxQuantity: Math.max(1, e.maxQuantity),
      maxTotalCents: e.maxTotalCents,
    }));
}

/** Ένα επίπεδο ασφάλειας όπως το βλέπει ο πελάτης — ΜΟΝΟ δημόσια πεδία. */
export interface PublicInsuranceOption {
  id: string;
  name: string;
  description: string;
  coverages: string[];
  priceCents: number;
  priceType: "per_day" | "per_rental";
  maxTotalCents: number | null;
  /** Η χρέωση για ΑΥΤΗ την ενοικίαση (ίδια συνάρτηση με την quote()). */
  totalCents: number;
  /** Συμμετοχή σε ζημιά — ΜΟΝΟ ενημερωτική. */
  excessCents: number | null;
}

/**
 * Τα επίπεδα ασφάλειας για τον τύπο οχήματος, με τη σειρά τους. Κενή λίστα →
 * η ενότητα «Ασφάλεια» δεν εμφανίζεται καθόλου. Καμία «προεπιλογή».
 */
export function insuranceOptions(ctx: QuoteContext, vehicleType: VehicleType, lang: string, days: number): PublicInsuranceOption[] {
  return insuranceLevelsFor(ctx, vehicleType).map((e) => ({
    id: e.id,
    name: textFor(e.name, lang),
    description: textFor(e.description, lang),
    coverages: (e.coverages ?? []).map((c) => textFor(c, lang)).filter(Boolean),
    priceCents: e.priceCents,
    priceType: e.priceType,
    maxTotalCents: e.maxTotalCents,
    totalCents: chargeTotalCents(e, days),
    excessCents: e.excessCents ?? null,
  }));
}
