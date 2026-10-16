// src/lib/public/bookingView.ts
// Τι βλέπει ο browser στη φόρμα κράτησης — καθαρή λογική, ΜΟΝΟ δημόσια πεδία.

import type { QuoteResult, VehicleType } from "./pricing";
import type { QuoteContext } from "./server";
import { textFor } from "./text";

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

export function toPublicQuote(q: QuoteResult): PublicQuote {
  return {
    ok: q.ok,
    errors: q.errors.map((e) => e.message),
    days: q.days,
    lines: q.lines.map((l) => ({ kind: l.kind, label: l.label, qty: l.qty, totalCents: l.totalCents })),
    totalCents: q.totalCents,
    listTotalCents: q.listTotalCents,
    vatCents: q.vatCents,
    depositCents: q.depositCents,
    excessCents: q.excessCents,
  };
}

/** Πρόσθετο/ασφάλεια που μπορεί να διαλέξει ο πελάτης (για τον τύπο οχήματος). */
export interface PublicExtraOption {
  id: string;
  kind: "EXTRA" | "INSURANCE";
  name: string;
  priceCents: number;
  priceType: "per_day" | "per_rental";
  maxQuantity: number;
  maxTotalCents: number | null;
  excessCents: number | null;
  isDefault: boolean;
}

export function extraOptions(ctx: QuoteContext, vehicleType: VehicleType, lang: string): PublicExtraOption[] {
  return ctx.extras
    .filter((e) => e.isActive && (e.vehicleTypes.length === 0 || e.vehicleTypes.includes(vehicleType)))
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      name: textFor(e.name, lang),
      priceCents: e.priceCents,
      priceType: e.priceType,
      maxQuantity: Math.max(1, e.maxQuantity),
      maxTotalCents: e.maxTotalCents,
      excessCents: e.excessCents ?? null,
      isDefault: e.kind === "INSURANCE" && e.isDefault,
    }));
}
