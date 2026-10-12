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
  settings: QuoteSettings;
  /** Για τους ελέγχους προθεσμίας· χωρίς αυτό δεν ελέγχονται. */
  now?: Date;
}

export type LineKind =
  | "rental"
  | "location"
  | "location_discount"
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

export interface QuoteResult {
  ok: boolean;
  errors: QuoteError[];
  days: number;
  lines: QuoteLine[];
  /** Σύνολο ΧΩΡΙΣ την έκπτωση τοποθεσίας (για διαγραμμένη τιμή). */
  listTotalCents: number;
  discountCents: number;
  discountBadge: string | null;
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

const nameOf = (t: LocalizedText) => ({ el: textFor(t, "el"), en: textFor(t, "en") });

const euro = (cents: number) => (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);

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

  // ── Έκπτωση/επιβάρυνση τοποθεσίας ──
  let badge: string | null = null;
  const locationLine = (loc: LocationInput, amount: number, fallbackEl: string, fallbackEn: string) => {
    if (amount === 0) return;
    const n = nameOf(loc.name);
    const custom = nameOf(loc.adjustmentLabel);
    lines.push({
      kind: amount < 0 ? "location_discount" : "location",
      label: both(custom.el || `${fallbackEl} ${n.el}`.trim(), custom.en || `${fallbackEn} ${n.en}`.trim()),
      qty: 1,
      unitCents: amount,
      totalCents: amount,
    });
  };
  if (pickupLoc && pickupLoc.adjustmentType !== "none" && pickupLoc.adjustmentValue !== 0) {
    if (pickupLoc.adjustmentType === "percent") {
      const amount = Math.round((rentalCents * pickupLoc.adjustmentValue) / 100);
      locationLine(pickupLoc, amount, amount < 0 ? "Έκπτωση" : "Επιβάρυνση", amount < 0 ? "Discount" : "Surcharge");
      if (amount < 0) badge = `-${Math.abs(pickupLoc.adjustmentValue)}%`;
    } else {
      locationLine(pickupLoc, pickupLoc.adjustmentValue, "Παραλαβή:", "Pick-up:");
    }
  }
  const oneWay = !!(pickupLoc && dropoffLoc && dropoffLoc.id !== pickupLoc.id);
  if (oneWay && dropoffLoc!.adjustmentType === "fixed" && dropoffLoc!.adjustmentValue !== 0) {
    locationLine(dropoffLoc!, dropoffLoc!.adjustmentValue, "Επιστροφή:", "Drop-off:");
  }
  if (oneWay && settings.oneWayFeeCents && settings.oneWayFeeCents > 0) {
    lines.push({
      kind: "one_way",
      label: both("Επιστροφή σε άλλο σημείο", "Different drop-off location"),
      qty: 1,
      unitCents: settings.oneWayFeeCents,
      totalCents: settings.oneWayFeeCents,
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
  const discountCents = -lines.filter((l) => l.kind === "location_discount").reduce((s, l) => s + l.totalCents, 0);
  const listTotalCents = lines.filter((l) => l.kind !== "location_discount").reduce((s, l) => s + l.totalCents, 0);
  if (!badge && discountCents > 0 && listTotalCents > 0) {
    badge = `-${Math.round((discountCents / listTotalCents) * 100)}%`;
  }
  if (discountCents > 0 && !badge) badge = `-${euro(discountCents)} €`;
  const vat = Math.max(0, settings.vatPercent);
  const vatCents = totalCents - Math.round(totalCents / (1 + vat / 100));

  return {
    ok: errors.length === 0,
    errors,
    days,
    lines,
    listTotalCents,
    discountCents,
    discountBadge: discountCents > 0 ? badge : null,
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

/**
 * Η χαμηλότερη ημερήσια τιμή των επόμενων `horizonDays` ημερών (από `today`,
 * "YYYY-MM-DD"), για το «από X €/ημέρα με ΦΠΑ». Κοιτά ΟΛΕΣ τις κλίμακες της
 * σεζόν κάθε ημέρας (η φθηνότερη είναι συνήθως η μεγάλη διάρκεια).
 * null αν δεν υπάρχει καμία θετική τιμή.
 */
export function fromPrice(
  target: Pick<TargetInput, "basePriceCents">,
  rates: RateInput[],
  seasons: SeasonInput[],
  today: string,
  horizonDays = 365
): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  let best: number | null = null;
  const consider = (cents: number) => {
    if (cents > 0 && (best === null || cents < best)) best = cents;
  };
  // Ανά ημέρα αλλάζει μόνο η σεζόν: κρατάμε cache ανά σεζόν.
  const cache = new Map<string, number | null>();
  for (let i = 0; i < horizonDays; i++) {
    const season = seasonFor(monthDayAfter(y, mo, d, i), seasons);
    const key = season?.id ?? "__all";
    if (cache.has(key)) continue;
    const rate = rateFor(season, rates);
    const prices = rate && rate.tiers.length > 0 ? rate.tiers.map((t) => t.dailyPriceCents) : [target.basePriceCents];
    const min = Math.min(...prices.filter((p) => p > 0));
    cache.set(key, Number.isFinite(min) ? min : null);
    if (Number.isFinite(min)) consider(min);
  }
  return best;
}
