// src/lib/public/bookingPlan.ts
// Υποβολή κράτησης από το site — η ΛΟΓΙΚΗ, χωρίς βάση (τη δίνει ο καλών).
//
//  planSiteBooking: ξανά ΟΛΟΙ οι έλεγχοι της αναζήτησης (παρελθόν, προθεσμία,
//    minDays, ηλικία, τοποθεσίες), κάρτα της ΙΔΙΑΣ εταιρίας, τιμή ΜΟΝΟ από την
//    quote() (ίδια μηχανή με όλη την εφαρμογή — καμία τιμή από τον browser),
//    ελεύθερο όχημα της ομάδας με τους κανόνες του availability.ts.
//  runSiteBooking: τα παραπάνω ΜΕΣΑ σε κλείδωμα της εταιρίας (pg_advisory_xact_lock
//    στον server): έλεγχος διαθεσιμότητας + εγγραφή γίνονται ατομικά, άρα δύο
//    ταυτόχρονες υποβολές για το τελευταίο όχημα δεν περνούν και οι δύο.

import { countAvailableByGroup, freeVehicleIds, type BlockingBooking, type FleetVehicle } from "./availability";
import { vehicleCardKey, type CatalogGroup, type CatalogVehicle } from "./catalog";
import { hasUnpricedDay, quoteFromContext, requestFromCriteria, NO_PRICE_MESSAGE } from "./engine";
import type { QuoteResult } from "./pricing";
import { nowLocal, validateCriteria, type SearchCriteria, type SearchRules } from "./search";
import type { QuoteContext } from "./server";
import { toPriceBreakdown, toStoredQuote, type StoredQuote } from "../pricingBridge";
import type { PriceBreakdown } from "../pricing";

export interface PlanCatalog {
  companyId: string;
  ctx: QuoteContext;
  groups: CatalogGroup[];
  vehicles: CatalogVehicle[];
  rules: SearchRules;
  prepTimeMinutes: number;
}

export interface PlanRequest {
  key: string;
  criteria: Pick<SearchCriteria, "pl" | "dl" | "from" | "to" | "age">;
  extras: { id: string; qty: number }[];
  insuranceId?: string | null;
  /** Η ηλικία από την ημερομηνία γέννησης (ήδη ελεγμένη ως προς την κλίμακα). */
  driverAge: number | null;
}

export type PlanError =
  | { code: "INVALID"; message: { el: string; en: string } }
  | { code: "UNAVAILABLE"; message: { el: string; en: string } }
  | { code: "NO_PRICE"; message: { el: string; en: string } }
  | { code: "NOT_FOUND"; message: { el: string; en: string } };

export interface SitePlan {
  vehicleId: string;
  rentalGroupId: string | null;
  quote: QuoteResult;
  breakdown: PriceBreakdown;
  stored: StoredQuote;
}

export const UNAVAILABLE_MESSAGE = {
  el: "Το όχημα δεν είναι πια διαθέσιμο για αυτές τις ημερομηνίες. Κάντε νέα αναζήτηση.",
  en: "This vehicle is no longer available for these dates. Please search again.",
};

const NOT_FOUND = { el: "Η επιλογή δεν βρέθηκε. Κάντε νέα αναζήτηση.", en: "This option was not found. Please search again." };

const fleetOf = (cat: PlanCatalog): FleetVehicle[] =>
  cat.vehicles.map((v) => ({
    id: v.id,
    tenantId: v.tenantId,
    groupKey: vehicleCardKey(v, cat.groups),
    status: v.status,
    isActive: v.isActive,
  }));

export function planSiteBooking(
  cat: PlanCatalog,
  req: PlanRequest,
  bookings: BlockingBooking[],
  now: Date = new Date()
): { ok: true; plan: SitePlan } | { ok: false; error: PlanError } {
  const criteria: SearchCriteria = { ...req.criteria, type: null };

  // ── Οι ΙΔΙΟΙ έλεγχοι με τη φόρμα αναζήτησης ──
  const problems = validateCriteria(criteria, cat.rules, now);
  if (problems.length > 0) return { ok: false, error: { code: "INVALID", message: problems[0].message } };

  // ── Κάρτα της ΙΔΙΑΣ εταιρίας (ομάδα από τον κατάλογό της) ──
  const fleet = fleetOf(cat);
  if (!fleet.some((v) => v.groupKey === req.key)) return { ok: false, error: { code: "NOT_FOUND", message: NOT_FOUND } };
  const base = requestFromCriteria(cat.ctx, cat.groups, req.key, { ...criteria, age: req.driverAge ?? criteria.age }, now);
  if (!base) return { ok: false, error: { code: "NOT_FOUND", message: NOT_FOUND } };

  // ── Τιμή: ΜΟΝΟ quote() (extras/ασφάλεια ως ids· κανένα ποσό από τον browser) ──
  const out = quoteFromContext(cat.ctx, { ...base, extras: req.extras, insuranceId: req.insuranceId });
  if (!out.ok) return { ok: false, error: { code: "NOT_FOUND", message: NOT_FOUND } };
  const q = out.result;
  if (hasUnpricedDay(q)) return { ok: false, error: { code: "NO_PRICE", message: NO_PRICE_MESSAGE } };
  if (!q.ok) return { ok: false, error: { code: "INVALID", message: q.errors[0].message } };

  // ── Διαθεσιμότητα ΤΩΡΑ (μέσα στο κλείδωμα) ──
  const availability = {
    companyId: cat.companyId,
    vehicles: fleet,
    bookings,
    from: criteria.from,
    to: criteria.to,
    prepMinutes: cat.prepTimeMinutes,
    now: nowLocal(cat.rules.timezone, now),
  };
  const free = freeVehicleIds(availability, req.key);
  if (free.length === 0 || (countAvailableByGroup(availability).get(req.key) ?? 0) === 0) {
    return { ok: false, error: { code: "UNAVAILABLE", message: UNAVAILABLE_MESSAGE } };
  }

  const group = req.key.startsWith("g.") ? cat.groups.find((g) => `g.${g.code}` === req.key) ?? null : null;
  return {
    ok: true,
    plan: {
      vehicleId: free[0],
      rentalGroupId: group?.id ?? null,
      quote: q,
      breakdown: toPriceBreakdown(q),
      stored: toStoredQuote(q, null, true, now),
    },
  };
}

/* ─────────────────────────────────────────────
   Εκτέλεση με κλείδωμα (η βάση δίνεται από τον καλούντα)
   ───────────────────────────────────────────── */

export interface BookingStore<Tx> {
  /** Τρέχει το fn σε transaction ΚΡΑΤΩΝΤΑΣ το κλείδωμα `lockKey` ως το τέλος της. */
  withLock<T>(lockKey: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Οι κρατήσεις που κλείνουν οχήματα στο διάστημα — διαβάζονται ΜΕΣΑ στο κλείδωμα. */
  loadBookings(tx: Tx, window: { from: string; to: string }): Promise<BlockingBooking[]>;
  /** Η εγγραφή (πελάτης, κράτηση, ειδοποίηση) — επιστρέφει τον κωδικό. */
  write(tx: Tx, plan: SitePlan): Promise<string>;
}

/** Ένα κλείδωμα ανά εταιρία: σειριοποιεί τις υποβολές της (και τον αύξοντα αριθμό κράτησης). */
export const lockKeyFor = (companyId: string) => `site-booking:${companyId}`;

export async function runSiteBooking<Tx>(
  store: BookingStore<Tx>,
  cat: PlanCatalog,
  req: PlanRequest,
  now: Date = new Date()
): Promise<{ ok: true; code: string } | { ok: false; error: PlanError }> {
  return store.withLock(lockKeyFor(cat.companyId), async (tx) => {
    const bookings = await store.loadBookings(tx, { from: req.criteria.from, to: req.criteria.to });
    const planned = planSiteBooking(cat, req, bookings, now);
    if (!planned.ok) return planned;
    const code = await store.write(tx, planned.plan);
    return { ok: true as const, code };
  });
}
