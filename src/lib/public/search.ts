// src/lib/public/search.ts
// Η αναζήτηση του δημόσιου site — ΚΑΘΑΡΗ λογική (χωρίς βάση, χωρίς React).
// Την τρέχουν ΚΑΙ ο browser (άμεσο μήνυμα στη φόρμα) ΚΑΙ ο server (πάντα ξανά,
// πριν από κάθε υπολογισμό) — ίδιοι έλεγχοι, ίδια μηνύματα ΕΛ/EN.
//
// URL: /s/<slug>/<lang>/search?pl=&dl=&from=YYYY-MM-DDTHH:mm&to=…&age=&type=
//   · pl / dl: slug τοποθεσίας (pickup_locations.slug)· dl ΥΠΟΧΡΕΩΤΙΚΟ όταν η
//     εταιρία έχει τοποθεσίες επιστροφής — στέλνεται ΠΑΝΤΑ, και όταν dl = pl
//   · from / to: «ώρα τοίχου» στη ζώνη της εταιρίας (Europe/Athens), ΠΟΤΕ ώρα
//     του browser — ο browser δεν μετατρέπει τίποτα, απλώς στέλνει το κείμενο
//   · age: ηλικία οδηγού (η αρχή της κλίμακας που διάλεξε)
//   · type: car | moto | atv (καρτέλα)

import {
  DEFAULT_TIMEZONE,
  VEHICLE_TYPES,
  localToUtcMs,
  parseLocal,
  rentalDays,
  seasonFor,
  type SeasonInput,
  type VehicleType,
} from "./pricing";

export interface SearchCriteria {
  pl: string | null;
  dl: string | null;
  from: string;
  to: string;
  age: number | null;
  type: VehicleType | null;
}

export interface SearchAgeBand {
  minAge: number;
  maxAge: number;
  allowed: boolean;
  isDefault: boolean;
  surchargeType: string;
}

export interface SearchLocation {
  slug: string;
  allowPickup: boolean;
  allowDropoff: boolean;
}

/** Ό,τι χρειάζεται ο έλεγχος — δημόσια στοιχεία, περνούν και στον browser. */
export interface SearchRules {
  timezone: string;
  graceMinutes: number;
  minLeadHours: number;
  maxAdvanceDays: number;
  defaultPickupTime: string;
  defaultDropoffTime: string;
  defaultRentalDays: number;
  seasons: Pick<SeasonInput, "id" | "name" | "startMonthDay" | "endMonthDay" | "minDays" | "priority" | "sortOrder">[];
  ageBands: SearchAgeBand[];
  locations: SearchLocation[];
}

export type SearchField = "pl" | "dl" | "from" | "to" | "age";

export interface SearchProblem {
  code: "INVALID_DATES" | "PAST" | "LEAD_TIME" | "TOO_FAR" | "ORDER" | "MIN_DAYS" | "AGE" | "LOCATION";
  field: SearchField;
  message: { el: string; en: string };
}

/* ─────────────────────────────────────────────
   Ημερομηνίες στη ζώνη της εταιρίας
   ───────────────────────────────────────────── */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** Ώρες ανά 30 λεπτά: "00:00" … "23:30". */
export const TIME_SLOTS: readonly string[] = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`);

/** Ώρα → η πλησιέστερη (προς τα κάτω) μισάωρη θέση. */
export function snapTime(time: string): string {
  const m = TIME_RE.exec(time);
  if (!m) return "10:00";
  return `${m[1]}:${Number(m[2]) >= 30 ? "30" : "00"}`;
}

/** Τώρα, ως «ώρα τοίχου» "YYYY-MM-DDTHH:mm" στη ζώνη tz (ανεξάρτητα από τον browser). */
export function nowLocal(tz: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now);
  } catch {
    return nowLocal(DEFAULT_TIMEZONE, now);
  }
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** "YYYY-MM-DD" + n ημέρες (ημερολογιακές, χωρίς ζώνη ώρας). */
export function addDays(date: string, n: number): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Ημερολογιακές ημέρες από a έως b ("YYYY-MM-DD"). */
export function daysBetween(a: string, b: string): number {
  const ma = DATE_RE.exec(a);
  const mb = DATE_RE.exec(b);
  if (!ma || !mb) return 0;
  const ta = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]));
  const tb = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]));
  return Math.round((tb - ta) / 86_400_000);
}

const splitLocal = (v: string): { date: string; time: string } => ({ date: v.slice(0, 10), time: v.slice(11, 16) });
const joinLocal = (date: string, time: string) => `${date}T${time}`;

/** Ελάχιστες ημέρες για παραλαβή σε αυτή την ημερομηνία (σεζόν της παραλαβής) — ή 1. */
export function minDaysFor(pickupDate: string, seasons: SearchRules["seasons"]): number {
  const s = seasonFor(pickupDate.slice(5, 10), seasons as SeasonInput[]);
  return s?.minDays && s.minDays > 1 ? s.minDays : 1;
}

/* ─────────────────────────────────────────────
   Προεπιλογές
   ───────────────────────────────────────────── */

/** Η ηλικία που προεπιλέγεται: η κλίμακα «προεπιλογή», αλλιώς η πρώτη χωρίς επιβάρυνση. */
export function defaultAge(bands: SearchAgeBand[]): number | null {
  const allowed = bands.filter((b) => b.allowed).sort((a, b) => a.minAge - b.minAge);
  const band =
    allowed.find((b) => b.isDefault) ?? allowed.find((b) => b.surchargeType === "none") ?? allowed[0] ?? null;
  return band ? band.minAge : null;
}

/**
 * Παραλαβή αύριο στην ώρα προεπιλογής (ή αργότερα, αν δεν καλύπτεται η
 * ελάχιστη προθεσμία), επιστροφή μετά από defaultRentalDays — ή minDays αν
 * είναι μεγαλύτερο.
 */
export function defaultCriteria(rules: SearchRules, now: Date = new Date()): SearchCriteria {
  const local = nowLocal(rules.timezone, now);
  const today = local.slice(0, 10);
  const pickupTime = snapTime(rules.defaultPickupTime);
  let pickupDate = addDays(today, 1);
  for (let i = 0; i < 60 && leadHours(joinLocal(pickupDate, pickupTime), local, rules.timezone) < rules.minLeadHours; i++) {
    pickupDate = addDays(pickupDate, 1);
  }
  const days = Math.max(rules.defaultRentalDays, minDaysFor(pickupDate, rules.seasons));
  const firstPickup = rules.locations.find((l) => l.allowPickup);
  return {
    pl: firstPickup?.slug ?? null,
    dl: null,
    from: joinLocal(pickupDate, pickupTime),
    to: joinLocal(addDays(pickupDate, days), snapTime(rules.defaultDropoffTime)),
    age: defaultAge(rules.ageBands),
    type: null,
  };
}

function leadHours(pickup: string, nowLocalValue: string, tz: string): number {
  const p = parseLocal(pickup);
  const n = parseLocal(nowLocalValue);
  if (!p || !n) return 0;
  return (localToUtcMs(p, tz) - localToUtcMs(n, tz)) / 3_600_000;
}

/* ─────────────────────────────────────────────
   URL ⇄ κριτήρια
   ───────────────────────────────────────────── */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function param(src: ParamSource, key: string): string {
  const v = src instanceof URLSearchParams ? src.get(key) : src[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s.trim().slice(0, 64) : "";
}

/** Από το URL. Ό,τι είναι άκυρο γίνεται κενό (ο έλεγχος το λέει μετά). */
export function parseCriteria(src: ParamSource): SearchCriteria {
  const pl = param(src, "pl");
  const dl = param(src, "dl");
  const age = Number(param(src, "age"));
  const type = param(src, "type");
  return {
    pl: SLUG_RE.test(pl) ? pl : null,
    dl: SLUG_RE.test(dl) ? dl : null,
    from: param(src, "from"),
    to: param(src, "to"),
    age: Number.isInteger(age) && age >= 16 && age <= 120 ? age : null,
    type: (VEHICLE_TYPES as readonly string[]).includes(type) ? (type as VehicleType) : null,
  };
}

/** Έχει το URL αναζήτηση; (αλλιώς η σελίδα αναζήτησης γυρνά στην αρχική) */
export const hasSearch = (src: ParamSource): boolean => !!param(src, "from") && !!param(src, "to");

/** Σε query string, με σταθερή σειρά (ίδιο κείμενο → ίδιο URL, κοινοποιήσιμο). */
export function criteriaToQuery(c: SearchCriteria, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  if (c.pl) q.set("pl", c.pl);
  if (c.dl) q.set("dl", c.dl);
  q.set("from", c.from);
  q.set("to", c.to);
  if (c.age !== null) q.set("age", String(c.age));
  if (c.type) q.set("type", c.type);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

/* ─────────────────────────────────────────────
   Έλεγχοι (browser + server)
   ───────────────────────────────────────────── */

const problem = (code: SearchProblem["code"], field: SearchField, el: string, en: string): SearchProblem => ({
  code,
  field,
  message: { el, en },
});

/** Ημέρες χρέωσης του διαστήματος (ίδιος κανόνας με την quote()) — ή 0 αν είναι άκυρο. */
export function searchDays(c: Pick<SearchCriteria, "from" | "to">, rules: Pick<SearchRules, "timezone" | "graceMinutes">): number {
  const a = parseLocal(c.from);
  const b = parseLocal(c.to);
  if (!a || !b) return 0;
  const am = localToUtcMs(a, rules.timezone);
  const bm = localToUtcMs(b, rules.timezone);
  return bm > am ? rentalDays(am, bm, rules.graceMinutes) : 0;
}

export function validateCriteria(c: SearchCriteria, rules: SearchRules, now: Date = new Date()): SearchProblem[] {
  const out: SearchProblem[] = [];
  const tz = rules.timezone;

  // ── Τοποθεσίες (μόνο αν η εταιρία έχει) ──
  const pickups = rules.locations.filter((l) => l.allowPickup);
  if (pickups.length > 0) {
    if (!c.pl || !pickups.some((l) => l.slug === c.pl)) {
      out.push(problem("LOCATION", "pl", "Διαλέξτε τοποθεσία παραλαβής.", "Choose a pick-up location."));
    }
    // Επιστροφή: ΠΑΝΤΑ ρητή επιλογή (και όταν είναι ίδια με την παραλαβή) —
    // εκτός αν η εταιρία δεν έχει καμία τοποθεσία επιστροφής.
    const dropoffs = rules.locations.filter((l) => l.allowDropoff);
    if (dropoffs.length > 0 && (!c.dl || !dropoffs.some((l) => l.slug === c.dl))) {
      out.push(problem("LOCATION", "dl", "Διαλέξτε τοποθεσία επιστροφής.", "Choose a drop-off location."));
    }
  }

  // ── Ημερομηνίες ──
  const pick = parseLocal(c.from);
  const drop = parseLocal(c.to);
  if (!pick || !drop || !TIME_RE.test(c.from.slice(11)) || !TIME_RE.test(c.to.slice(11))) {
    out.push(problem("INVALID_DATES", pick ? "to" : "from", "Διαλέξτε ημερομηνίες και ώρες.", "Choose dates and times."));
  } else {
    const pickupMs = localToUtcMs(pick, tz);
    const dropoffMs = localToUtcMs(drop, tz);
    const n = parseLocal(nowLocal(tz, now))!;
    const nowMs = localToUtcMs(n, tz);
    const lead = (pickupMs - nowMs) / 3_600_000;

    if (pickupMs <= nowMs) {
      out.push(problem("PAST", "from", "Η παραλαβή είναι στο παρελθόν.", "The pick-up time is in the past."));
    } else if (lead < rules.minLeadHours) {
      out.push(
        problem(
          "LEAD_TIME",
          "from",
          `Η παραλαβή πρέπει να είναι τουλάχιστον ${rules.minLeadHours} ώρες από τώρα.`,
          `Pick-up must be at least ${rules.minLeadHours} hours from now.`
        )
      );
    } else if (lead > rules.maxAdvanceDays * 24) {
      out.push(
        problem(
          "TOO_FAR",
          "from",
          `Κρατήσεις έως ${rules.maxAdvanceDays} ημέρες μπροστά.`,
          `Bookings up to ${rules.maxAdvanceDays} days ahead.`
        )
      );
    }

    if (dropoffMs <= pickupMs) {
      out.push(problem("ORDER", "to", "Η επιστροφή πρέπει να είναι μετά την παραλαβή.", "Drop-off must be after pick-up."));
    } else {
      const days = rentalDays(pickupMs, dropoffMs, rules.graceMinutes);
      const min = minDaysFor(splitLocal(c.from).date, rules.seasons);
      if (days < min) {
        out.push(
          problem(
            "MIN_DAYS",
            "to",
            `Ελάχιστη διάρκεια ${min} ημέρες για αυτές τις ημερομηνίες.`,
            `Minimum rental is ${min} days for these dates.`
          )
        );
      }
    }
  }

  // ── Ηλικία (μόνο αν η εταιρία έχει κλίμακες) ──
  if (rules.ageBands.length > 0 && c.age !== null) {
    const band = rules.ageBands.find((b) => c.age! >= b.minAge && c.age! <= b.maxAge);
    if (!band || !band.allowed) {
      const allowed = rules.ageBands.filter((b) => b.allowed);
      const lo = Math.min(...allowed.map((b) => b.minAge));
      const hi = Math.max(...allowed.map((b) => b.maxAge));
      out.push(
        allowed.length > 0
          ? problem("AGE", "age", `Η ηλικία οδηγού πρέπει να είναι ${lo}–${hi}.`, `Driver age must be ${lo}–${hi}.`)
          : problem("AGE", "age", "Η ηλικία οδηγού δεν επιτρέπεται.", "Driver age not allowed.")
      );
    }
  }
  return out;
}
