// src/lib/bookingPricing.ts
// Η τιμή μιας κράτησης/συμβολαίου ΣΤΟΝ SERVER — από την ΙΔΙΑ μηχανή με το
// δημόσιο site (computeQuoteForTenant → quote()). Δεύτερος υπολογισμός
// τιμής δεν υπάρχει.
//
// Ο client στέλνει ΜΟΝΟ ids και επιλογές (όχημα, ώρες, σημεία, πρόσθετα,
// τρόπο έκπτωσης). Ό,τι ποσό κι αν έρθει από τη φόρμα αγνοείται.
// Όλα φιλτράρονται με tenantId: πρόσθετο ή κωδικός άλλης εταιρίας δεν
// εφαρμόζεται ποτέ.
//
// Πάνω στην τιμή της quote() μπαίνει μόνο η έκπτωση ΚΩΔΙΚΟΥ/χειροκίνητη του
// dashboard (στρογγυλοποιημένη σε ακέραιο €, ίδιος κανόνας).

import { db } from "./db";
import { resolveDiscountCode } from "./discounts";
import { buildExtrasSnapshot, type DiscountMode, type ExtrasSnapshot, type PriceBreakdown } from "./pricing";
import { computeQuoteForTenant } from "./public/quoteServer";
import { INSURANCE_INVALID_MESSAGE, NO_PRICE_MESSAGE, hasUnpricedDay, requestFromBooking } from "./public/engine";
import { fromCents } from "./public/money";
import type { QuoteLine } from "./public/pricing";
import { manualDiscountCents, storedManualDiscount, toPriceBreakdown, toStoredQuote, type StoredQuote } from "./pricingBridge";

export interface PricingRequest {
  tenantId: string;
  vehicleId: string;
  /** Για κωδικούς δεμένους σε πελάτη και την ηλικία του (αν δεν δόθηκε). */
  customerId: string;
  pickupDate: string;
  pickupTime: string | null;
  returnDate: string;
  returnTime: string | null;
  pickupLocation?: string | null;
  returnLocation?: string | null;
  /** "YYYY-MM-DD" του κύριου οδηγού· αλλιώς του πελάτη από τη βάση. */
  driverBirthDate?: string | null;
  /** Πρόσθετα ΚΑΙ (το πολύ ένα) επίπεδο ασφάλειας. Καμία ασφάλεια δεν μπαίνει μόνη της. */
  extraIds: string[];
  discountMode: DiscountMode;
  discountValue?: number;
  discountCode?: string | null;
}

export type PricingOutcome =
  | {
      ok: true;
      breakdown: PriceBreakdown;
      snapshot: ExtrasSnapshot;
      /** Ο κωδικός που όντως εφαρμόστηκε, αλλιώς null. */
      discountCode: string | null;
      dailyRate: number;
      /** Ολόκληρη η ανάλυση (για αποθήκευση στο bookings."priceQuote"). */
      quote: StoredQuote;
      /** Οι γραμμές της quote() — ίδια ανάλυση με το site. */
      quoteLines: QuoteLine[];
      /** false = δεν υπάρχει τιμή στις ρυθμίσεις → μόνο χειροκίνητη. */
      autoPrice: boolean;
      /** Μηνύματα της quote() που δεν μπλοκάρουν το dashboard (π.χ. minDays). */
      warnings: string[];
    }
  | { ok: false; message: string };

/**
 * Η ΧΕΙΡΟΚΙΝΗΤΗ έκπτωση μιας ΥΠΑΡΧΟΥΣΑΣ κράτησης, όπως τη διαβάζει ο
 * ξαναϋπολογισμός: με κωδικό → ο κωδικός ξαναελέγχεται· με ποσό → το ίδιο
 * ποσό· αλλιώς καμία.
 *
 * Από την ενιαία τιμολόγηση (SQL 22) το discountAmount περιέχει ΚΑΙ την
 * αυτόματη προσφορά. Όταν υπάρχει priceQuote, η χειροκίνητη έκπτωση
 * διαβάζεται ΜΟΝΟ από το priceQuote.manualDiscount — αλλιώς η προσφορά θα
 * μετρούσε δύο φορές (μία από τη quote() και μία ως «ποσό»).
 */
export function discountOfBooking(b: {
  discountCode: string | null;
  discountAmount: unknown;
  priceQuote?: unknown;
}): { discountMode: DiscountMode; discountValue?: number; discountCode: string | null } {
  const stored = storedManualDiscount(b.priceQuote);
  if (stored !== undefined) {
    if (!stored) return { discountMode: "NONE", discountCode: null };
    if (stored.code) return { discountMode: "CODE", discountCode: stored.code };
    return { discountMode: "AMOUNT", discountValue: stored.cents / 100, discountCode: null };
  }
  const discountMode: DiscountMode = b.discountCode
    ? "CODE"
    : Number(b.discountAmount) > 0
      ? "AMOUNT"
      : "NONE";
  return {
    discountMode,
    discountValue: discountMode === "AMOUNT" ? Number(b.discountAmount) : undefined,
    discountCode: b.discountCode,
  };
}

/** Σφάλματα της quote() που ΣΤΑΜΑΤΟΥΝ και το dashboard (λάθος επιλογή extra). */
const BLOCKING = new Set(["EXTRA_NOT_FOR_VEHICLE", "EXTRA_QUANTITY", "INVALID_DATES"]);

export async function priceBooking(req: PricingRequest): Promise<PricingOutcome> {
  const wanted = Array.from(new Set(req.extraIds));
  const [vehicle, extras, customer] = await Promise.all([
    db.vehicle.findFirst({ where: { id: req.vehicleId, tenantId: req.tenantId }, select: { id: true } }),
    wanted.length
      ? db.extra.findMany({
          where: { id: { in: wanted }, tenantId: req.tenantId, isActive: true },
          select: { id: true, chargeType: true, type: true },
        })
      : Promise.resolve([]),
    req.driverBirthDate === undefined && req.customerId
      ? db.customer.findFirst({ where: { id: req.customerId, tenantId: req.tenantId }, select: { dateOfBirth: true } })
      : Promise.resolve(null),
  ]);
  if (!vehicle) return { ok: false, message: "Το όχημα δεν βρέθηκε" };
  // Πρόσθετο άλλης εταιρίας ή απενεργοποιημένο: δεν σιωπούμε, απορρίπτουμε.
  if (extras.length !== wanted.length) return { ok: false, message: "Κάποιο πρόσθετο δεν είναι διαθέσιμο πλέον" };
  // Το πολύ ΕΝΑ επίπεδο ασφάλειας ανά κράτηση.
  if (extras.filter((e) => e.type === "INSURANCE").length > 1) return { ok: false, message: "Διαλέξτε μία μόνο ασφάλεια" };

  const birth = req.driverBirthDate ?? customer?.dateOfBirth?.toISOString().slice(0, 10) ?? null;
  const engine = await computeQuoteForTenant(req.tenantId, (ctx) =>
    requestFromBooking(ctx, {
      vehicleId: vehicle.id,
      pickupDate: req.pickupDate,
      pickupTime: req.pickupTime,
      returnDate: req.returnDate,
      returnTime: req.returnTime,
      pickupLocation: req.pickupLocation,
      returnLocation: req.returnLocation,
      driverBirthDate: birth,
      extraIds: wanted,
    })
  );
  if (!engine.ok) {
    return { ok: false, message: engine.reason === "insurance" ? INSURANCE_INVALID_MESSAGE.el : "Το όχημα δεν βρέθηκε" };
  }
  const q = engine.result;

  const blocking = q.errors.find((e) => BLOCKING.has(e.code));
  if (blocking) return { ok: false, message: blocking.message.el };
  const autoPrice = !hasUnpricedDay(q);
  const warnings = q.errors
    .filter((e) => e.code !== "NO_PRICE")
    .map((e) => e.message.el)
    .concat(autoPrice ? [] : [NO_PRICE_MESSAGE.el]);

  // ── Έκπτωση του dashboard (κωδικός / ποσό / %) πάνω στο σύνολο της quote() ──
  const base = fromCents(q.totalCents);
  let euros = 0;
  let appliedCode: string | null = null;
  if (req.discountMode === "CODE") {
    const code = (req.discountCode ?? "").trim();
    if (!code) return { ok: false, message: "Δώσε κωδικό έκπτωσης" };
    const resolved = await resolveDiscountCode({
      tenantId: req.tenantId,
      code,
      baseAmount: base,
      totalDays: q.days,
      customerId: req.customerId,
    });
    if (!resolved.ok) return { ok: false, message: resolved.message };
    euros = resolved.discount.amount;
    appliedCode = resolved.discount.code;
  } else if (req.discountMode === "AMOUNT") {
    euros = Math.max(0, req.discountValue ?? 0);
  } else if (req.discountMode === "PERCENT") {
    euros = (base * Math.min(100, Math.max(0, req.discountValue ?? 0))) / 100;
  }
  const manualCents = manualDiscountCents(euros, q.totalCents);

  const extraMeta = new Map(extras.map((e) => [e.id, { chargeType: e.chargeType as string, type: e.type as string }]));
  const breakdown = toPriceBreakdown(q, { manualDiscountCents: manualCents, extraMeta });
  return {
    ok: true,
    breakdown,
    snapshot: buildExtrasSnapshot(breakdown.lines),
    discountCode: appliedCode,
    dailyRate: breakdown.dailyRate,
    quote: toStoredQuote(q, { cents: manualCents, code: appliedCode }, autoPrice),
    quoteLines: q.lines,
    autoPrice,
    warnings,
  };
}
