// src/lib/public/pricing.ts
// Μηχανή τιμής του δημόσιου site — ΚΑΘΑΡΕΣ συναρτήσεις, χωρίς βάση.
//
// · quote(input)   → πλήρης ανάλυση μιας κράτησης (γραμμή-γραμμή).
// · fromPrice(...) → «από X €/ημέρα» για τις επόμενες 365 ημέρες.
//
// Τη χρησιμοποιούν ο server (PR 2–3) και ο «Δοκιμαστικός υπολογισμός» του
// dashboard. Τα δεδομένα τα φορτώνει ο server (src/lib/public/server.ts) και
// τα μετατρέπει σε cents ΠΡΙΝ φτάσουν εδώ.
//
// Κανόνες:
// · Όλα σε ακέραια λεπτά (cents), ΜΕ ΦΠΑ· στρογγυλοποίηση ανά γραμμή.
// · Ημέρες = ceil((επιστροφή − παραλαβή − grace) / 24ω), ελάχιστο 1, με τις
//   ώρες ως «ώρα τοίχου» στη ζώνη ώρας της εταιρίας (σωστό και σε αλλαγή ώρας).
// · Η κλίμακα (tier) διαλέγεται από τις ΣΥΝΟΛΙΚΕΣ ημέρες· κάθε ημέρα χρεώνεται
//   με τη σεζόν της (κράτηση από χαμηλή σε υψηλή σπάει σωστά).
// · ΦΠΑ μόνο για εμφάνιση: vat = total − total / (1 + vat%).

import { textFor, type LocalizedText } from "./text";

export const VEHICLE_TYPES = ["car", "moto", "atv"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export interface Tier {
  minDays: number;
  /** null = χωρίς άνω όριο. */
  maxDays: number | null;
  dailyPriceCents: number;
}

export interface RateInput {
  /** null = όλο τον χρόνο. */
  seasonId: string | null;
  tiers: Tier[];
}

export interface SeasonInput {
  id: string;
  name: LocalizedText;
  startMonthDay: string; // "MM-DD"
  endMonthDay: string; // "MM-DD" — μπορεί να «περνά» αλλαγή χρόνου
  minDays: number | null;
  priority: number;
  sortOrder?: number;
}

export interface TargetInput {
  vehicleType: VehicleType;
  /** Για τις προσφορές: η ομάδα (και του οχήματος, αν έχει) και το όχημα. */
  rentalGroupId?: string | null;
  vehicleId?: string | null;
  /** Τιμή ημέρας όταν δεν υπάρχει rate (ομάδα: basePriceCents, όχημα: dailyRate). */
  basePriceCents: number;
  depositCents: number | null;
  excessCents: number | null;
  minDriverAge?: number | null;
}

export interface LocationInput {
  id: string;
  name: LocalizedText;
  adjustmentType: "none" | "percent" | "fixed";
  /** percent: % (−10 = −10%) · fixed: cents (αρνητικό = έκπτωση). */
  adjustmentValue: number;
  adjustmentLabel: LocalizedText;
  /** null = προεπιλογή εταιρίας, 0 = δωρεάν. */
  afterHoursFeeCents: number | null;
  allowPickup: boolean;
  allowDropoff: boolean;
  /** Χρέωση δρομολογίου όταν ο πελάτης ΠΑΡΑΛΑΜΒΑΝΕΙ εδώ (cents). SQL 21c. */
  deliveryFeeCents?: number;
  /** Χρέωση δρομολογίου όταν ο πελάτης ΕΠΙΣΤΡΕΦΕΙ εδώ (cents). */
  collectionFeeCents?: number;
  /** Από τόσες ημέρες και πάνω, οι χρεώσεις δρομολογίου του σημείου = 0. */
  feeFreeFromDays?: number | null;
  feeLabel?: LocalizedText;
}

/** Προσφορά (πίνακας promotions, SQL 21c). Κενή λίστα = ισχύει για όλα. */
export interface PromotionInput {
  id: string;
  name: LocalizedText;
  badge: LocalizedText;
  isActive: boolean;
  discountType: "percent" | "per_day" | "per_rental";
  /** percent: 1–90 · per_day / per_rental: cents. */
  discountValue: number;
  /** "YYYY-MM-DD" — πραγματικές ημερομηνίες, συμπεριλαμβάνονται και οι δύο. */
  validFrom: string;
  validTo: string;
  locationIds: string[];
  locationMatch: "pickup" | "dropoff" | "either";
  rentalGroupIds: string[];
  vehicleIds: string[];
  vehicleTypes: string[];
  minDays: number | null;
  sortOrder: number;
}

export interface AgeBandInput {
  minAge: number;
  maxAge: number;
  label: LocalizedText;
  allowed: boolean;
  isDefault: boolean;
  surchargeType: "none" | "per_day" | "per_rental";
  surchargeCents: number;
  surchargeMaxCents: number | null;
}

export interface ChargeInput {
  id: string;
  name: LocalizedText;
  priceType: "per_day" | "per_rental";
  priceCents: number;
  /** Ταβάνι ανά τεμάχιο (null = χωρίς). */
  maxTotalCents: number | null;
  maxQuantity: number;
  /** Κενό = για όλους τους τύπους. */
  vehicleTypes: string[];
  /** Μόνο ασφάλειες: απαλλαγή. */
  excessCents?: number | null;
}

export interface QuoteSettings {
  timezone: string;
  graceMinutes: number;
  afterHours: { start: string; end: string; feeCents: number };
  oneWayFeeCents: number | null;
  minLeadHours?: number;
  maxAdvanceDays?: number;
  vatPercent: number;
}

export interface QuoteInput {
  /** "YYYY-MM-DDTHH:mm" — ώρα τοίχου στη ζώνη της εταιρίας. */
  pickupAt: string;
  dropoffAt: string;
  target: TargetInput;
  rates: RateInput[];
  seasons: SeasonInput[];
  pickupLocation?: LocationInput | null;
  dropoffLocation?: LocationInput | null;
  driverAge?: number | null;
  ageBands: AgeBandInput[];
  extras?: { charge: ChargeInput; qty: number }[];
  insurance?: ChargeInput | null;
  promotions?: PromotionInput[];
  settings: QuoteSettings;
  /** Για τους ελέγχους προθεσμίας· χωρίς αυτό δεν ελέγχονται. */
  now?: Date;
}

export type LineKind =
  | "rental"
  | "location"
  | "discount"
  | "delivery"
  | "collection"
  | "one_way"
  | "after_hours"
  | "driver_age"
  | "extra"
  | "insurance";

export interface QuoteLine {
  kind: LineKind;
  label: LocalizedText;
  qty: number;
  unitCents: number;
  totalCents: number;
}

export interface QuoteError {
  code: string;
  message: { el: string; en: string };
}

/** Μια έκπτωση που ίσχυε: της τοποθεσίας ή μιας προσφοράς. */
export interface DiscountCandidate {
  source: "location" | "promotion";
  /** id τοποθεσίας ή προσφοράς. */
  id: string;
  name: LocalizedText;
  /** Πόσο θα μείωνε το ενοίκιο (cents, θετικό). */
  amountCents: number;
  /** "-15%" για ποσοστό, αλλιώς το κείμενο της προσφοράς. */
  badge: LocalizedText;
  /** Το κείμενο της γραμμής «Έκπτωση: …» (κείμενο προσφοράς / ετικέτα τοποθεσίας). */
  label: LocalizedText;
  sortOrder: number;
}

export interface QuoteResult {
  ok: boolean;
  errors: QuoteError[];
  days: number;
  lines: QuoteLine[];
  /** Σύνολο ΧΩΡΙΣ την έκπτωση (για διαγραμμένη τιμή). */
  listTotalCents: number;
  discountCents: number;
  /** "-15%" για ποσοστό, αλλιώς το κείμενο της προσφοράς· null χωρίς έκπτωση. */
  discountBadge: LocalizedText | null;
  /** Ποια έκπτωση εφαρμόστηκε και ποιες άλλες ίσχυαν αλλά έχασαν (χωρίς άθροισμα). */
  discounts: { applied: DiscountCandidate | null; others: DiscountCandidate[] };
  totalCents: number;
  vatCents: number;
  avgDailyCents: number;
  depositCents: number | null;
  excessCents: number | null;
}

/* ─────────────────────────────────────────────
   Ημερομηνίες / ζώνη ώρας
   ───────────────────────────────────────────── */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;

export const DEFAULT_TIMEZONE = "Europe/Athens";

function safeTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Μετατόπιση της ζώνης (ms) τη στιγμή utcMs. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const p: Record<string, number> = {};
  for (const x of parts) if (x.type !== "literal") p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

interface LocalDateTime {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
}

export function parseLocal(value: string): LocalDateTime | null {
  const m = LOCAL_RE.exec(value);
  if (!m) return null;
  const [y, mo, d, hh, mm] = m.slice(1).map(Number);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || hh > 23 || mm > 59) return null;
  return { y, m: mo, d, hh, mm };
}

/** Ώρα τοίχου στη ζώνη tz → πραγματική στιγμή (ms). */
export function localToUtcMs(l: LocalDateTime, tz: string): number {
  const guess = Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm);
  const off1 = tzOffsetMs(guess, tz);
  const t = guess - off1;
  const off2 = tzOffsetMs(t, tz);
  return off2 === off1 ? t : guess - off2;
}

/** Ημέρες χρέωσης: ceil((διάρκεια − grace) / 24ω), ελάχιστο 1. */
export function rentalDays(pickupMs: number, dropoffMs: number, graceMinutes: number): number {
  const minutes = Math.round((dropoffMs - pickupMs) / 60_000) - Math.max(0, graceMinutes);
  return Math.max(1, Math.ceil(minutes / 1440));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "MM-DD" της ημέρας i μετά από (y, m, d). */
function monthDayAfter(y: number, m: number, d: number, i: number): string {
  const t = new Date(Date.UTC(y, m - 1, d) + i * DAY_MS);
  return `${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** "YYYY-MM-DD" της ημέρας i μετά από (y, m, d). */
function dateAfter(y: number, m: number, d: number, i: number): string {
  const t = new Date(Date.UTC(y, m - 1, d) + i * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Ανήκει η "MM-DD" στη σεζόν; (και για σεζόν που περνά αλλαγή χρόνου) */
export function inSeason(monthDay: string, s: Pick<SeasonInput, "startMonthDay" | "endMonthDay">): boolean {
  if (!MONTH_DAY_RE.test(s.startMonthDay) || !MONTH_DAY_RE.test(s.endMonthDay)) return false;
  return s.startMonthDay <= s.endMonthDay
    ? monthDay >= s.startMonthDay && monthDay <= s.endMonthDay
    : monthDay >= s.startMonthDay || monthDay <= s.endMonthDay;
}

/** Η σεζόν μιας ημέρας: σε επικάλυψη κερδίζει η μεγαλύτερη priority. */
export function seasonFor(monthDay: string, seasons: SeasonInput[]): SeasonInput | null {
  let best: SeasonInput | null = null;
  for (const s of seasons) {
    if (!inSeason(monthDay, s)) continue;
    if (
      !best ||
      s.priority > best.priority ||
      (s.priority === best.priority && (s.sortOrder ?? 0) < (best.sortOrder ?? 0))
    ) {
      best = s;
    }
  }
  return best;
}

/** Η κλίμακα για τις συνολικές ημέρες. */
export function pickTier(tiers: Tier[], days: number): Tier | null {
  const valid = tiers.filter((t) => Number.isFinite(t.minDays) && t.dailyPriceCents >= 0);
  if (valid.length === 0) return null;
  const fits = valid.filter((t) => t.minDays <= days && (t.maxDays === null || days <= t.maxDays));
  const pool = fits.length > 0 ? fits : valid.filter((t) => t.minDays <= days);
  if (pool.length > 0) return pool.reduce((a, b) => (b.minDays > a.minDays ? b : a));
  // Λιγότερες ημέρες από την πρώτη κλίμακα: η μικρότερη.
  return valid.reduce((a, b) => (b.minDays < a.minDays ? b : a));
}

function rateFor(season: SeasonInput | null, rates: RateInput[]): RateInput | null {
  return (
    (season && rates.find((r) => r.seasonId === season.id)) ||
    rates.find((r) => r.seasonId === null) ||
    null
  );
}

/** Ώρα "HH:mm" μέσα στο παράθυρο (και για παράθυρο που περνά τα μεσάνυχτα). */
export function inWindow(time: string, start: string, end: string): boolean {
  if (!TIME_RE.test(time) || !TIME_RE.test(start) || !TIME_RE.test(end) || start === end) return false;
  return start < end ? time >= start && time < end : time >= start || time < end;
}

/* ─────────────────────────────────────────────
   Μηνύματα σφαλμάτων
   ───────────────────────────────────────────── */

const err = (code: string, el: string, en: string): QuoteError => ({ code, message: { el, en } });

const both = (el: string, en: string): LocalizedText => ({ el, en });

/** «Έκπτωση: Χ» — χωρίς να διπλασιάζεται αν το Χ ξεκινά ήδη με τη λέξη. */
const withPrefix = (word: string, text: string) =>
  text.toLocaleLowerCase("el").startsWith(word.toLocaleLowerCase("el")) ? text : `${word}: ${text}`;

const nameOf = (t: LocalizedText) => ({ el: textFor(t, "el"), en: textFor(t, "en") });


/* ─────────────────────────────────────────────
   Προσφορές
   ───────────────────────────────────────────── */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Ταιριάζει το όχημα; Όλες οι λίστες κενές = όλα· αλλιώς αρκεί ΜΙΑ. */
export function promotionMatchesTarget(
  p: Pick<PromotionInput, "rentalGroupIds" | "vehicleIds" | "vehicleTypes">,
  t: Pick<TargetInput, "vehicleType" | "rentalGroupId" | "vehicleId">
): boolean {
  if (p.rentalGroupIds.length === 0 && p.vehicleIds.length === 0 && p.vehicleTypes.length === 0) return true;
  return (
    (!!t.rentalGroupId && p.rentalGroupIds.includes(t.rentalGroupId)) ||
    (!!t.vehicleId && p.vehicleIds.includes(t.vehicleId)) ||
    p.vehicleTypes.includes(t.vehicleType)
  );
}

/** Ταιριάζει η τοποθεσία; Κενή λίστα = όλες· αλλιώς κατά το locationMatch. */
export function promotionMatchesLocation(
  p: Pick<PromotionInput, "locationIds" | "locationMatch">,
  pickupId: string | null,
  dropoffId: string | null
): boolean {
  if (p.locationIds.length === 0) return true;
  const atPickup = !!pickupId && p.locationIds.includes(pickupId);
  const atDropoff = !!dropoffId && p.locationIds.includes(dropoffId);
  return p.locationMatch === "pickup" ? atPickup : p.locationMatch === "dropoff" ? atDropoff : atPickup || atDropoff;
}

/**
 * Πόσο μειώνει μια προσφορά το ενοίκιο (cents) — ή null αν δεν ισχύει.
 * Μόνο οι ημέρες μέσα στο [validFrom, validTo] εκπτώνονται· ποτέ κάτω από 0 ανά ημέρα.
 */
export function promotionAmount(
  p: PromotionInput,
  ctx: {
    target: TargetInput;
    days: number;
    /** "YYYY-MM-DD" κάθε ημέρας ενοικίασης (ημερολογιακές, στη ζώνη της εταιρίας). */
    dayDates: string[];
    dayPrices: number[];
    pickupLocationId: string | null;
    dropoffLocationId: string | null;
  }
): number | null {
  if (!p.isActive || !DATE_RE.test(p.validFrom) || !DATE_RE.test(p.validTo) || p.validFrom > p.validTo) return null;
  if (p.minDays && ctx.days < p.minDays) return null;
  if (!promotionMatchesTarget(p, ctx.target)) return null;
  if (!promotionMatchesLocation(p, ctx.pickupLocationId, ctx.dropoffLocationId)) return null;
  const inside = ctx.dayDates
    .map((date, i) => ({ date, price: Math.max(0, ctx.dayPrices[i] ?? 0) }))
    .filter((d) => d.date >= p.validFrom && d.date <= p.validTo);
  if (inside.length === 0) return null;
  const rentInside = inside.reduce((s, d) => s + d.price, 0);
  if (p.discountType === "percent") {
    const pct = Math.min(90, Math.max(0, p.discountValue));
    return Math.round((rentInside * pct) / 100);
  }
  if (p.discountType === "per_day") {
    return inside.reduce((s, d) => s + Math.min(d.price, Math.max(0, p.discountValue)), 0);
  }
  return Math.min(rentInside, Math.max(0, p.discountValue));
}

/**
 * Το παλιό adjustmentType 'fixed' (θετικό ποσό) → χρεώσεις δρομολογίου.
 * ΙΔΙΟΣ κανόνας με τη μεταφορά του SQL 21c (για δεδομένα που δεν έχουν ακόμα
 * περάσει από αυτήν). Αρνητικό 'fixed' (παλιά σταθερή έκπτωση) δεν μεταφέρεται
 * και δεν εφαρμόζεται πια: η έκπτωση τοποθεσίας είναι μόνο ποσοστό.
 */
export function migrateLegacyFixed<T extends Pick<LocationInput, "adjustmentType" | "adjustmentValue" | "adjustmentLabel" | "deliveryFeeCents" | "collectionFeeCents" | "feeLabel">>(loc: T): T {
  if (loc.adjustmentType !== "fixed" || loc.adjustmentValue <= 0) return loc;
  return {
    ...loc,
    deliveryFeeCents: loc.adjustmentValue,
    collectionFeeCents: loc.adjustmentValue,
    feeLabel: loc.adjustmentLabel,
    adjustmentType: "none",
    adjustmentValue: 0,
  };
}

/* ─────────────────────────────────────────────
   quote()
   ───────────────────────────────────────────── */

const emptyResult = (errors: QuoteError[]): QuoteResult => ({
  ok: false,
  errors,
  days: 0,
  lines: [],
  listTotalCents: 0,
  discountCents: 0,
  discountBadge: null,
  discounts: { applied: null, others: [] },
  totalCents: 0,
  vatCents: 0,
  avgDailyCents: 0,
  depositCents: null,
  excessCents: null,
});

export function quote(input: QuoteInput): QuoteResult {
  const { settings, target } = input;
  const tz = safeTimezone(settings.timezone || DEFAULT_TIMEZONE);
  const pick = parseLocal(input.pickupAt);
  const drop = parseLocal(input.dropoffAt);
  if (!pick || !drop) {
    return emptyResult([err("INVALID_DATES", "Μη έγκυρη ημερομηνία ή ώρα.", "Invalid date or time.")]);
  }
  const pickupMs = localToUtcMs(pick, tz);
  const dropoffMs = localToUtcMs(drop, tz);
  if (dropoffMs <= pickupMs) {
    return emptyResult([
      err("INVALID_DATES", "Η επιστροφή πρέπει να είναι μετά την παραλαβή.", "Drop-off must be after pick-up."),
    ]);
  }

  const errors: QuoteError[] = [];
  const lines: QuoteLine[] = [];
  const days = rentalDays(pickupMs, dropoffMs, settings.graceMinutes);

  // ── Προθεσμίες ──
  if (input.now) {
    const leadHours = (pickupMs - input.now.getTime()) / 3_600_000;
    if (settings.minLeadHours !== undefined && leadHours < settings.minLeadHours) {
      errors.push(
        err(
          "LEAD_TIME",
          `Η παραλαβή πρέπει να είναι τουλάχιστον ${settings.minLeadHours} ώρες από τώρα.`,
          `Pick-up must be at least ${settings.minLeadHours} hours from now.`
        )
      );
    }
    if (settings.maxAdvanceDays !== undefined && leadHours > settings.maxAdvanceDays * 24) {
      errors.push(
        err(
          "TOO_FAR",
          `Κρατήσεις έως ${settings.maxAdvanceDays} ημέρες μπροστά.`,
          `Bookings up to ${settings.maxAdvanceDays} days ahead.`
        )
      );
    }
  }

  // ── Τοποθεσίες ──
  const pickupLoc = input.pickupLocation ?? null;
  const dropoffLoc = input.dropoffLocation ?? pickupLoc;
  if (pickupLoc && !pickupLoc.allowPickup) {
    errors.push(err("LOCATION_NO_PICKUP", "Δεν γίνεται παραλαβή σε αυτό το σημείο.", "Pick-up is not available here."));
  }
  if (dropoffLoc && !dropoffLoc.allowDropoff) {
    errors.push(err("LOCATION_NO_DROPOFF", "Δεν γίνεται επιστροφή σε αυτό το σημείο.", "Drop-off is not available here."));
  }

  // ── Ενοίκιο: κάθε ημέρα με τη σεζόν της ──
  const pickupSeason = seasonFor(monthDayAfter(pick.y, pick.m, pick.d, 0), input.seasons);
  if (pickupSeason?.minDays && days < pickupSeason.minDays) {
    const s = nameOf(pickupSeason.name);
    errors.push(
      err(
        "MIN_DAYS",
        `Ελάχιστη διάρκεια ${pickupSeason.minDays} ημέρες για παραλαβή ${s.el ? `στη σεζόν «${s.el}»` : "αυτή την περίοδο"}.`,
        `Minimum rental is ${pickupSeason.minDays} days for pick-up ${s.en ? `in "${s.en}"` : "in this period"}.`
      )
    );
  }

  const perDay: { season: SeasonInput | null; price: number }[] = [];
  for (let i = 0; i < days; i++) {
    const season = seasonFor(monthDayAfter(pick.y, pick.m, pick.d, i), input.seasons);
    const rate = rateFor(season, input.rates);
    const tier = rate ? pickTier(rate.tiers, days) : null;
    perDay.push({ season, price: Math.round(tier ? tier.dailyPriceCents : target.basePriceCents) });
  }
  // Συνεχόμενες ημέρες με ίδια σεζόν και τιμή → μία γραμμή.
  const runs: { season: SeasonInput | null; price: number; count: number }[] = [];
  for (const day of perDay) {
    const last = runs[runs.length - 1];
    if (last && last.season?.id === day.season?.id && last.price === day.price) last.count += 1;
    else runs.push({ ...day, count: 1 });
  }
  for (const run of runs) {
    const sn = run.season ? nameOf(run.season.name) : null;
    lines.push({
      kind: "rental",
      label: sn && (sn.el || sn.en)
        ? both(`Ενοίκιο · ${sn.el || sn.en}`, `Rental · ${sn.en || sn.el}`)
        : both("Ενοίκιο", "Rental"),
      qty: run.count,
      unitCents: run.price,
      totalCents: run.price * run.count,
    });
  }
  const rentalCents = lines.reduce((s, l) => s + l.totalCents, 0);
  if (rentalCents <= 0) {
    errors.push(err("NO_PRICE", "Δεν έχει οριστεί τιμή για αυτό το όχημα.", "No price is set for this vehicle."));
  }

  // ── Επιβάρυνση τοποθεσίας (μόνο θετικό ποσοστό· η έκπτωση πάει στις εκπτώσεις) ──
  if (pickupLoc && pickupLoc.adjustmentType === "percent" && pickupLoc.adjustmentValue > 0) {
    const amount = Math.round((rentalCents * pickupLoc.adjustmentValue) / 100);
    const n = nameOf(pickupLoc.name);
    const custom = nameOf(pickupLoc.adjustmentLabel);
    lines.push({
      kind: "location",
      label: both(custom.el || `Επιβάρυνση ${n.el}`.trim(), custom.en || `Surcharge ${n.en}`.trim()),
      qty: 1,
      unitCents: amount,
      totalCents: amount,
    });
  }

  // ── Χρεώσεις δρομολογίου: κάθε σκέλος χωριστά (ίδιο σημείο = δύο δρομολόγια) ──
  const routeLine = (loc: LocationInput, kind: "delivery" | "collection") => {
    const fee = Math.max(0, Math.round((kind === "delivery" ? loc.deliveryFeeCents : loc.collectionFeeCents) ?? 0));
    if (fee === 0) return;
    const free = loc.feeFreeFromDays != null && loc.feeFreeFromDays > 0 && days >= loc.feeFreeFromDays;
    const what = nameOf(loc.feeLabel ?? {});
    const n = nameOf(loc.name);
    const textEl = what.el || n.el;
    const textEn = what.en || n.en || textEl;
    const freeEl = free ? ` (Δωρεάν από ${loc.feeFreeFromDays} ημέρες)` : "";
    const freeEn = free ? ` (Free from ${loc.feeFreeFromDays} days)` : "";
    lines.push({
      kind,
      label:
        kind === "delivery"
          ? both(`Παράδοση: ${textEl}${freeEl}`, `Delivery: ${textEn}${freeEn}`)
          : both(`Παραλαβή: ${textEl}${freeEl}`, `Collection: ${textEn}${freeEn}`),
      qty: 1,
      unitCents: free ? 0 : fee,
      totalCents: free ? 0 : fee,
    });
  };
  if (pickupLoc) routeLine(pickupLoc, "delivery");
  if (dropoffLoc) routeLine(dropoffLoc, "collection");

  const oneWay = !!(pickupLoc && dropoffLoc && dropoffLoc.id !== pickupLoc.id);
  if (oneWay && settings.oneWayFeeCents && settings.oneWayFeeCents > 0) {
    lines.push({
      kind: "one_way",
      label: both("Επιστροφή σε άλλο σημείο", "Different drop-off location"),
      qty: 1,
      unitCents: settings.oneWayFeeCents,
      totalCents: settings.oneWayFeeCents,
    });
  }

  // ── Εκπτώσεις: τοποθεσία + προσφορές, ΧΩΡΙΣ άθροισμα — μόνο η μεγαλύτερη ──
  const candidates: DiscountCandidate[] = [];
  if (pickupLoc && pickupLoc.adjustmentType === "percent" && pickupLoc.adjustmentValue < 0) {
    const pct = Math.min(100, Math.abs(pickupLoc.adjustmentValue));
    const custom = nameOf(pickupLoc.adjustmentLabel);
    const n = nameOf(pickupLoc.name);
    candidates.push({
      source: "location",
      id: pickupLoc.id,
      name: both(custom.el || n.el, custom.en || n.en),
      amountCents: Math.round((rentalCents * pct) / 100),
      badge: both(`-${pct}%`, `-${pct}%`),
      label: both(custom.el || `-${pct}%`, custom.en || custom.el || `-${pct}%`),
      sortOrder: -1,
    });
  }
  const dayDates = perDay.map((_, i) => dateAfter(pick.y, pick.m, pick.d, i));
  for (const p of input.promotions ?? []) {
    const amount = promotionAmount(p, {
      target,
      days,
      dayDates,
      dayPrices: perDay.map((x) => x.price),
      pickupLocationId: pickupLoc?.id ?? null,
      dropoffLocationId: dropoffLoc?.id ?? null,
    });
    if (amount === null || amount <= 0) continue;
    candidates.push({
      source: "promotion",
      id: p.id,
      name: p.name,
      amountCents: amount,
      badge: p.discountType === "percent" ? both(`-${p.discountValue}%`, `-${p.discountValue}%`) : p.badge,
      label: p.badge,
      sortOrder: p.sortOrder,
    });
  }
  candidates.sort((a, b) => b.amountCents - a.amountCents || a.sortOrder - b.sortOrder);
  const applied = candidates[0] ?? null;
  if (applied) {
    const amount = Math.min(applied.amountCents, rentalCents);
    const label = nameOf(applied.label);
    lines.push({
      kind: "discount",
      label: both(withPrefix("Έκπτωση", label.el || label.en), withPrefix("Discount", label.en || label.el)),
      qty: 1,
      unitCents: -amount,
      totalCents: -amount,
    });
  }

  // ── Εκτός ωραρίου ──
  const afterHours = (time: string, loc: LocationInput | null, el: string, en: string) => {
    if (!inWindow(time, settings.afterHours.start, settings.afterHours.end)) return;
    const fee = loc?.afterHoursFeeCents ?? settings.afterHours.feeCents;
    if (!fee || fee <= 0) return;
    lines.push({ kind: "after_hours", label: both(el, en), qty: 1, unitCents: fee, totalCents: fee });
  };
  afterHours(`${pad(pick.hh)}:${pad(pick.mm)}`, pickupLoc, "Παραλαβή εκτός ωραρίου", "Out-of-hours pick-up");
  afterHours(`${pad(drop.hh)}:${pad(drop.mm)}`, dropoffLoc, "Επιστροφή εκτός ωραρίου", "Out-of-hours drop-off");

  // ── Ηλικία οδηγού ──
  if (input.ageBands.length > 0) {
    const band =
      input.driverAge === null || input.driverAge === undefined
        ? input.ageBands.find((b) => b.isDefault) ?? null
        : input.ageBands.find((b) => input.driverAge! >= b.minAge && input.driverAge! <= b.maxAge) ?? null;
    if (!band) {
      errors.push(
        err("AGE_OUT_OF_RANGE", "Δεν μπορούμε να εξυπηρετήσουμε οδηγό αυτής της ηλικίας.", "We cannot rent to a driver of this age.")
      );
    } else if (!band.allowed) {
      errors.push(err("AGE_NOT_ALLOWED", "Η ηλικία οδηγού δεν επιτρέπεται.", "Driver age not allowed."));
    } else if (band.surchargeType !== "none" && band.surchargeCents > 0) {
      const raw = band.surchargeType === "per_day" ? band.surchargeCents * days : band.surchargeCents;
      const total = band.surchargeMaxCents !== null ? Math.min(raw, band.surchargeMaxCents) : raw;
      const l = nameOf(band.label);
      lines.push({
        kind: "driver_age",
        label: both(l.el || "Επιβάρυνση ηλικίας οδηγού", l.en || "Driver age surcharge"),
        qty: band.surchargeType === "per_day" ? days : 1,
        unitCents: band.surchargeCents,
        totalCents: total,
      });
    }
  }
  if (target.minDriverAge && input.driverAge !== null && input.driverAge !== undefined && input.driverAge < target.minDriverAge) {
    errors.push(
      err(
        "AGE_UNDER_GROUP_MIN",
        `Για αυτό το όχημα ο οδηγός πρέπει να είναι τουλάχιστον ${target.minDriverAge} ετών.`,
        `The driver must be at least ${target.minDriverAge} for this vehicle.`
      )
    );
  }

  // ── Extras και ασφάλεια ──
  const charge = (c: ChargeInput, qty: number, kind: "extra" | "insurance") => {
    if (qty <= 0) return;
    const n = nameOf(c.name);
    if (c.vehicleTypes.length > 0 && !c.vehicleTypes.includes(target.vehicleType)) {
      errors.push(
        err("EXTRA_NOT_FOR_VEHICLE", `Το «${n.el}» δεν διατίθεται για αυτό το όχημα.`, `"${n.en}" is not available for this vehicle.`)
      );
      return;
    }
    if (qty > Math.max(1, c.maxQuantity)) {
      errors.push(
        err("EXTRA_QUANTITY", `Το «${n.el}»: έως ${c.maxQuantity} τεμάχια.`, `"${n.en}": up to ${c.maxQuantity} items.`)
      );
      return;
    }
    const perUnit = c.priceType === "per_day" ? c.priceCents * days : c.priceCents;
    const capped = c.maxTotalCents !== null ? Math.min(perUnit, c.maxTotalCents) : perUnit;
    lines.push({
      kind,
      label: both(n.el, n.en),
      qty: c.priceType === "per_day" ? days * qty : qty,
      unitCents: c.priceCents,
      totalCents: Math.round(capped * qty),
    });
  };
  for (const e of input.extras ?? []) charge(e.charge, Math.floor(e.qty), "extra");
  if (input.insurance) charge(input.insurance, 1, "insurance");

  // ── Σύνολα ──
  const totalCents = Math.max(0, lines.reduce((s, l) => s + l.totalCents, 0));
  const discountCents = Math.abs(lines.filter((l) => l.kind === "discount").reduce((s, l) => s + l.totalCents, 0));
  const listTotalCents = lines.filter((l) => l.kind !== "discount").reduce((s, l) => s + l.totalCents, 0);
  const vat = Math.max(0, settings.vatPercent);
  const vatCents = totalCents - Math.round(totalCents / (1 + vat / 100));

  return {
    ok: errors.length === 0,
    errors,
    days,
    lines,
    listTotalCents,
    discountCents,
    discountBadge: discountCents > 0 && applied ? applied.badge : null,
    discounts: { applied, others: candidates.slice(1) },
    totalCents,
    vatCents,
    avgDailyCents: Math.round(totalCents / days),
    depositCents: target.depositCents,
    excessCents: input.insurance?.excessCents ?? target.excessCents,
  };
}

/* ─────────────────────────────────────────────
   fromPrice()
   ───────────────────────────────────────────── */

export interface FromPriceResult {
  /** Η χαμηλότερη ημερήσια τιμή (με την καλύτερη προσφορά, αν υπάρχει). */
  dailyCents: number;
  /** Η ίδια ημέρα χωρίς προσφορά (για διαγραμμένη τιμή). */
  listDailyCents: number;
  /** Το κείμενο της προσφοράς που έδωσε την τιμή — null αν καμία. */
  badge: LocalizedText | null;
}

/**
 * Η χαμηλότερη ημερήσια τιμή των επόμενων `horizonDays` ημερών (από `today`,
 * "YYYY-MM-DD"), για το «από X €/ημέρα με ΦΠΑ». Κοιτά ΟΛΕΣ τις κλίμακες της
 * σεζόν κάθε ημέρας (η φθηνότερη είναι συνήθως η μεγάλη διάρκεια).
 *
 * Προσφορές: μόνο ενεργές, ΧΩΡΙΣ περιορισμό τοποθεσίας (αλλιώς το «από»
 * θα ήταν παραπλανητικό) και για το συγκεκριμένο όχημα/ομάδα. Ποσοστό και
 * ανά ημέρα μετρούν· η «ανά ενοικίαση» δεν εκφράζεται ανά ημέρα και αγνοείται.
 * null αν δεν υπάρχει καμία θετική τιμή.
 */
export function fromPrice(
  target: Pick<TargetInput, "basePriceCents"> & Partial<Pick<TargetInput, "vehicleType" | "rentalGroupId" | "vehicleId">>,
  rates: RateInput[],
  seasons: SeasonInput[],
  today: string,
  opts: { horizonDays?: number; promotions?: PromotionInput[] } = {}
): FromPriceResult | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  const horizon = opts.horizonDays ?? 365;
  const t = { vehicleType: target.vehicleType ?? "car", rentalGroupId: target.rentalGroupId ?? null, vehicleId: target.vehicleId ?? null };
  const promos = (opts.promotions ?? []).filter(
    (p) =>
      p.isActive &&
      p.locationIds.length === 0 &&
      p.discountType !== "per_rental" &&
      p.validFrom <= p.validTo &&
      promotionMatchesTarget(p, t)
  );

  let best: FromPriceResult | null = null;
  const seasonMin = new Map<string, number | null>();
  for (let i = 0; i < horizon; i++) {
    const season = seasonFor(monthDayAfter(y, mo, d, i), seasons);
    const key = season?.id ?? "__all";
    if (!seasonMin.has(key)) {
      const rate = rateFor(season, rates);
      const prices = (rate && rate.tiers.length > 0 ? rate.tiers.map((x) => x.dailyPriceCents) : [target.basePriceCents]).filter((p) => p > 0);
      seasonMin.set(key, prices.length > 0 ? Math.min(...prices) : null);
    }
    const list = seasonMin.get(key);
    if (list == null) continue;
    const date = dateAfter(y, mo, d, i);
    let daily = list;
    let badge: LocalizedText | null = null;
    for (const p of promos) {
      if (date < p.validFrom || date > p.validTo) continue;
      const v =
        p.discountType === "percent"
          ? Math.round(list * (1 - Math.min(90, Math.max(0, p.discountValue)) / 100))
          : Math.max(0, list - Math.max(0, p.discountValue));
      if (v < daily) {
        daily = v;
        badge = p.discountType === "percent" ? both(`-${p.discountValue}%`, `-${p.discountValue}%`) : p.badge;
      }
    }
    if (daily > 0 && (!best || daily < best.dailyCents)) best = { dailyCents: daily, listDailyCents: list, badge };
  }
  return best;
}
