// tests/booking-default-1-day.test.mjs — δημόσιο site: προεπιλεγμένη διάρκεια
// 1 ημέρα (ένας ορισμός: DEFAULT_BOOKING.defaultRentalDays), ο πελάτης αλλάζει
// ελεύθερα την επιστροφή, το minDays της σεζόν ισχύει όπως πριν.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const { defaultCriteria, validateCriteria, criteriaToQuery, parseCriteria, minDaysFor, daysBetween } = await import("../src/lib/public/search.ts");
const { DEFAULT_BOOKING, readBooking } = await import("../src/lib/public/siteSettings.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// Κανόνες όπως τους βγάζει το site.ts για εταιρία ΧΩΡΙΣ αποθηκευμένη ρύθμιση ημερών.
const booking = readBooking({});
const RULES = {
  timezone: "Europe/Athens",
  graceMinutes: 59,
  minLeadHours: booking.minLeadHours,
  maxAdvanceDays: booking.maxAdvanceDays,
  defaultPickupTime: booking.defaultPickupTime,
  defaultDropoffTime: booking.defaultDropoffTime,
  defaultRentalDays: booking.defaultRentalDays,
  seasons: [
    { id: "high", name: { el: "Υψηλή" }, startMonthDay: "07-01", endMonthDay: "08-31", minDays: 5, priority: 1 },
    { id: "low", name: { el: "Χαμηλή" }, startMonthDay: "09-01", endMonthDay: "06-30", minDays: null, priority: 0 },
  ],
  ageBands: [{ minAge: 25, maxAge: 70, allowed: true, isDefault: true, surchargeType: "none" }],
  locations: [
    { slug: "chania-airport", allowPickup: true, allowDropoff: true },
    { slug: "kissamos", allowPickup: true, allowDropoff: true },
  ],
};
const NOW = new Date("2026-10-14T06:00:00.000Z"); // 09:00 Ελλάδας, χαμηλή σεζόν

test("προεπιλογή: 1 ημέρα — ένας ορισμός (DEFAULT_BOOKING), ίδιος σε server και browser", () => {
  assert.equal(DEFAULT_BOOKING.defaultRentalDays, 1);
  assert.equal(booking.defaultRentalDays, 1, "χωρίς αποθηκευμένη τιμή → 1");
  const c = defaultCriteria(RULES, NOW);
  assert.equal(c.from, "2026-10-15T10:00");
  assert.equal(c.to, "2026-10-16T10:00", "επιστροφή = παραλαβή + 1 ημέρα, ίδια ώρα");
  assert.equal(daysBetween(c.from.slice(0, 10), c.to.slice(0, 10)), 1);
  assert.equal(c.from.slice(11), c.to.slice(11));
  // Με επιστροφή τα κριτήρια περνούν τον έλεγχο (κανένα MIN_DAYS σε χαμηλή σεζόν).
  assert.deepEqual(validateCriteria({ ...c, dl: c.pl }, RULES, NOW), []);
  // Καμία άλλη σταθερή «3» στα σημεία που φτιάχνουν την προεπιλογή.
  assert.doesNotMatch(read("src/app/(dashboard)/dashboard/storefront/SettingsTabs.tsx"), /defaultRentalDays", v \?\? 3\)/);
  assert.match(read("src/lib/public/search.ts"), /Math\.max\(rules\.defaultRentalDays, minDaysFor\(pickupDate, rules\.seasons\)\)/);
  assert.match(read("src/lib/public/site.ts"), /defaultRentalDays: booking\.defaultRentalDays/);
  // Η αρχική, η αναζήτηση και η κράτηση παίρνουν την ίδια προεπιλογή (defaultCriteria).
  const routes = read("src/lib/storefront/routes.tsx");
  assert.match(routes, /const initial = defaultCriteria\(cat\.rules\);/);
  assert.match(routes, /criteria\.from && criteria\.to \? criteria : defaultCriteria\(cat\.rules\)/);
});

test("η εταιρία που όρισε δικές της ημέρες τις κρατά (π.χ. 3)", () => {
  assert.equal(readBooking({ defaultRentalDays: 3 }).defaultRentalDays, 3);
  assert.equal(defaultCriteria({ ...RULES, defaultRentalDays: 3 }, NOW).to, "2026-10-18T10:00");
  assert.equal(readBooking({ defaultRentalDays: 0 }).defaultRentalDays, 1, "εκτός ορίων → προεπιλογή");
});

test("ο πελάτης αλλάζει ελεύθερα τις ημέρες· τα κριτήρια στο URL μένουν ίδια", () => {
  const c = { ...defaultCriteria(RULES, NOW), dl: "kissamos", type: "car" };
  for (const to of ["2026-10-16T10:00", "2026-10-17T18:30", "2026-10-25T09:00"]) {
    const changed = { ...c, to };
    assert.deepEqual(validateCriteria(changed, RULES, NOW), [], to);
    const back = parseCriteria(new URLSearchParams(criteriaToQuery(changed)));
    assert.deepEqual(back, changed, "pl, dl, from, to, age, type ίδια μετά από URL");
  }
  // Το ίδιο και με παραλαβή αυθημερόν με επιστροφή (λίγες ώρες).
  assert.deepEqual(validateCriteria({ ...c, to: "2026-10-15T18:00" }, RULES, NOW), []);
});

test("σεζόν με minDays > 1: η προεπιλογή ανεβαίνει και ο έλεγχος MIN_DAYS μένει", () => {
  const summer = new Date("2026-07-10T06:00:00.000Z");
  const c = defaultCriteria(RULES, summer);
  assert.equal(minDaysFor("2026-07-11", RULES.seasons), 5);
  assert.equal(c.from, "2026-07-11T10:00");
  assert.equal(c.to, "2026-07-16T10:00", "υψηλή σεζόν: 5 ημέρες (minDays), όχι 1");
  // Ο πελάτης βάζει λιγότερες → η υπάρχουσα προειδοποίηση.
  const short = validateCriteria({ ...c, dl: c.pl, to: "2026-07-12T10:00" }, RULES, summer);
  assert.deepEqual(short.map((p) => p.code), ["MIN_DAYS"]);
  assert.deepEqual(validateCriteria({ ...c, dl: c.pl }, RULES, summer), []);
});
