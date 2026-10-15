// src/lib/public/engine.ts
// Η ΜΙΑ μηχανή τιμής της εφαρμογής — καθαρή λογική πάνω στην quote().
//
// Site (αναζήτηση, /book), dashboard (κράτηση, συμβόλαιο, «Δοκιμαστικός
// υπολογισμός») περνούν ΟΛΑ από το quoteFromContext(ctx, request):
//   · ctx  = loadQuoteContext(companyId) (src/lib/public/server.ts) — οι ίδιοι
//            πίνακες (σεζόν, rates, προσφορές, extras, τοποθεσίες, ηλικίες,
//            ΦΠΑ, ωράριο), ΜΙΑ ανάγνωση, κανένα αντίγραφο.
//   · request = ΤΙ ζητήθηκε (όχημα/ομάδα, ώρες, σημεία, ηλικία, extras).
// Οι δύο «μεταφραστές» (requestFromCriteria για το site, requestFromBooking για
// το dashboard) καταλήγουν στο ΙΔΙΟ request για τα ίδια δεδομένα → ίδια τιμή.
//
// Server: computeQuoteForTenant (src/lib/public/quoteServer.ts).

import type { QuoteContext } from "./server";
import { defaultInsuranceFor } from "./insuranceDefaults";
import { quote, type QuoteResult, type TargetInput, type RateInput } from "./pricing";
import { textFor } from "./text";

export interface QuoteRequest {
  /** Ομάδα, ή όχημα (που τιμολογείται με την ομάδα του, αν έχει). */
  target: { kind: "group" | "vehicle"; id: string };
  /** "YYYY-MM-DDTHH:mm" — ώρα τοίχου της εταιρίας. */
  pickupAt: string;
  dropoffAt: string;
  pickupLocationId?: string | null;
  /** null/undefined = ίδιο με την παραλαβή. */
  dropoffLocationId?: string | null;
  /** null = προεπιλεγμένη κλίμακα ηλικίας. */
  driverAge?: number | null;
  extras?: { id: string; qty: number }[];
  /** undefined = η προεπιλεγμένη ασφάλεια του τύπου· null = καμία· id = αυτή. */
  insuranceId?: string | null;
  /** Για τους ελέγχους προθεσμίας (μόνο το site). */
  now?: Date;
}

export type EngineOutcome =
  | { ok: true; result: QuoteResult; subject: { target: TargetInput; rates: RateInput[] } }
  | { ok: false; reason: "not_found" };

/** Όχημα → η ομάδα του (αν υπάρχει)· έτσι dashboard και site τιμολογούν ίδια. */
export function subjectOf(ctx: QuoteContext, target: QuoteRequest["target"]) {
  if (target.kind === "group") return ctx.groups.get(target.id) ?? null;
  const v = ctx.vehicles.get(target.id);
  if (!v) return null;
  const groupId = v.target.rentalGroupId;
  return (groupId && ctx.groups.get(groupId)) || v;
}

export function quoteFromContext(ctx: QuoteContext, req: QuoteRequest): EngineOutcome {
  const subject = subjectOf(ctx, req.target);
  if (!subject) return { ok: false, reason: "not_found" };
  const loc = (id: string | null | undefined) => (id ? ctx.locations.find((l) => l.id === id && l.isActive) ?? null : null);
  const pickup = loc(req.pickupLocationId);
  const active = ctx.extras.filter((e) => e.isActive);
  const insurance =
    req.insuranceId === undefined
      ? defaultInsuranceFor(active.map((e) => ({ ...e, type: e.kind })), subject.target.vehicleType)
      : req.insuranceId === null
        ? null
        : active.find((e) => e.id === req.insuranceId && e.kind === "INSURANCE") ?? null;
  const result = quote({
    pickupAt: req.pickupAt,
    dropoffAt: req.dropoffAt,
    target: subject.target,
    rates: subject.rates,
    seasons: ctx.seasons,
    pickupLocation: pickup,
    dropoffLocation: loc(req.dropoffLocationId) ?? pickup,
    driverAge: req.driverAge ?? null,
    ageBands: ctx.ageBands,
    extras: (req.extras ?? []).flatMap((x) => {
      const charge = active.find((e) => e.id === x.id && e.kind === "EXTRA");
      return charge ? [{ charge, qty: x.qty }] : [];
    }),
    insurance,
    promotions: ctx.promotions,
    settings: ctx.settings,
    now: req.now,
  });
  return { ok: true, result, subject };
}

/** Λείπει τιμή για κάποια ημέρα (σεζόν χωρίς rate και βασική τιμή 0); */
export const hasUnpricedDay = (q: QuoteResult): boolean =>
  q.errors.some((e) => e.code === "NO_PRICE") || q.lines.some((l) => l.kind === "rental" && l.unitCents <= 0);

export const NO_PRICE_MESSAGE = {
  el: "Δεν υπάρχει τιμή στις ρυθμίσεις για αυτές τις ημερομηνίες",
  en: "No price is set for these dates",
} as const;

/* ─────────────────────────────────────────────
   Site: κάρτα ("g.<code>" / "v.<id>") + κριτήρια URL → request
   ───────────────────────────────────────────── */

export function requestFromCriteria(
  ctx: QuoteContext,
  groups: { id: string; code: string }[],
  key: string,
  c: { pl: string | null; dl: string | null; from: string; to: string; age: number | null },
  now?: Date
): QuoteRequest | null {
  let target: QuoteRequest["target"] | null = null;
  if (key.startsWith("g.")) {
    const g = groups.find((x) => `g.${x.code}` === key);
    if (g) target = { kind: "group", id: g.id };
  } else if (key.startsWith("v.")) {
    target = { kind: "vehicle", id: key.slice(2) };
  }
  if (!target) return null;
  const bySlug = (slug: string | null) => (slug ? ctx.locations.find((l) => l.slug === slug && l.isActive)?.id ?? null : null);
  return {
    target,
    pickupAt: c.from,
    dropoffAt: c.to,
    pickupLocationId: bySlug(c.pl),
    dropoffLocationId: bySlug(c.dl),
    driverAge: c.age,
    now,
  };
}

/* ─────────────────────────────────────────────
   Dashboard: κράτηση / συμβόλαιο → request
   ───────────────────────────────────────────── */

/** Ίδιο κλειδί σύγκρισης με το combobox του συμβολαίου (contractLocations.ts). */
const placeKey = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Το σημείο του συμβολαίου είναι ελεύθερο κείμενο (combobox): ταιριάζει με
 * τοποθεσία των ρυθμίσεων όταν είναι το ίδιο όνομα (ΕΛ/EN) ή slug. Αλλιώς
 * null → χωρίς χρεώσεις δρομολογίου (όπως ένα σημείο εκτός λίστας).
 */
export function matchLocation(text: string | null | undefined, locations: QuoteContext["locations"]): string | null {
  if (!text || !text.trim()) return null;
  const k = placeKey(text);
  const hit = locations.find(
    (l) => l.isActive && (placeKey(l.slug) === k || placeKey(textFor(l.name, "el")) === k || placeKey(textFor(l.name, "en")) === k)
  );
  return hit?.id ?? null;
}

/** Ηλικία (ολόκληρα έτη) στην ημέρα παραλαβής — ή null αν δεν ξέρουμε ημερομηνία γέννησης. */
export function ageAt(birthDate: string | null | undefined, onDate: string): number | null {
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate ?? "");
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(onDate);
  if (!b || !d) return null;
  let age = Number(d[1]) - Number(b[1]);
  if (`${d[2]}-${d[3]}` < `${b[2]}-${b[3]}`) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export interface BookingPriceInput {
  vehicleId: string;
  pickupDate: string;
  pickupTime: string | null;
  returnDate: string;
  returnTime: string | null;
  pickupLocation?: string | null;
  returnLocation?: string | null;
  /** "YYYY-MM-DD" του κύριου οδηγού (για την κλίμακα ηλικίας). */
  driverBirthDate?: string | null;
  /** Τα επιλεγμένα πρόσθετα ΚΑΙ ασφάλειες (όπως τα στέλνει η φόρμα). */
  extraIds: string[];
  /** false = χωρίς επιλεγμένη ασφάλεια ΔΕΝ μπαίνει η προεπιλεγμένη (παλιές κρατήσεις). */
  defaultInsurance?: boolean;
}

/**
 * Κράτηση/συμβόλαιο → request. Ασφάλεια: η επιλεγμένη· αν δεν επιλέχθηκε
 * καμία, η προεπιλεγμένη του τύπου (ΟΠΩΣ στο site). Παλιές κρατήσεις χωρίς
 * ώρα: 10:00 (όπως η προεπιλογή του site).
 */
export function requestFromBooking(ctx: QuoteContext, b: BookingPriceInput): QuoteRequest {
  const chosen = ctx.extras.filter((e) => b.extraIds.includes(e.id));
  const insurance = chosen.find((e) => e.kind === "INSURANCE");
  return {
    target: { kind: "vehicle", id: b.vehicleId },
    pickupAt: `${b.pickupDate}T${b.pickupTime || "10:00"}`,
    dropoffAt: `${b.returnDate}T${b.returnTime || "10:00"}`,
    pickupLocationId: matchLocation(b.pickupLocation, ctx.locations),
    dropoffLocationId: matchLocation(b.returnLocation, ctx.locations),
    driverAge: ageAt(b.driverBirthDate, b.pickupDate),
    extras: chosen.filter((e) => e.kind === "EXTRA").map((e) => ({ id: e.id, qty: 1 })),
    insuranceId: insurance ? insurance.id : b.defaultInsurance === false ? null : undefined,
  };
}
