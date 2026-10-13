// tests/public-pricing.test.mjs
// Μηχανή τιμής του δημόσιου site: src/lib/public/pricing.ts + money.ts.
// Τρέχει με `npm test` (node:test).

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

// Τα .ts του src εισάγουν σχετικά αρχεία χωρίς κατάληξη ("./text").
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const { quote, fromPrice, seasonFor, rentalDays, pickTier, inWindow, migrateLegacyFixed } = await import("../src/lib/public/pricing.ts");
const { toCents, parseEuroInput, centsToInput } = await import("../src/lib/public/money.ts");

/* ── Δεδομένα ── */

const SEASONS = [
  { id: "low", name: { el: "Χαμηλή", en: "Low" }, startMonthDay: "11-01", endMonthDay: "05-31", minDays: null, priority: 0 },
  { id: "mid", name: { el: "Μέση", en: "Mid" }, startMonthDay: "06-01", endMonthDay: "06-30", minDays: null, priority: 0 },
  { id: "high", name: { el: "Υψηλή", en: "High" }, startMonthDay: "07-01", endMonthDay: "08-31", minDays: 3, priority: 1 },
  { id: "xmas", name: { el: "Χριστούγεννα", en: "Christmas" }, startMonthDay: "12-15", endMonthDay: "01-10", minDays: null, priority: 2 },
];

const tiers = (a, b, c) => [
  { minDays: 1, maxDays: 3, dailyPriceCents: a },
  { minDays: 4, maxDays: 6, dailyPriceCents: b },
  { minDays: 7, maxDays: null, dailyPriceCents: c },
];

const RATES = [
  { seasonId: "low", tiers: tiers(3500, 3000, 2600) },
  { seasonId: "high", tiers: tiers(7000, 6500, 6000) },
  { seasonId: "xmas", tiers: [{ minDays: 1, maxDays: null, dailyPriceCents: 5000 }] },
  // Η «Μέση» δεν έχει δική της: πέφτει στο «όλο τον χρόνο».
  { seasonId: null, tiers: tiers(4500, 4200, 4000) },
];

const TARGET = { vehicleType: "car", basePriceCents: 9900, depositCents: 30000, excessCents: 80000, minDriverAge: null };

const SETTINGS = {
  timezone: "Europe/Athens",
  graceMinutes: 59,
  afterHours: { start: "23:00", end: "07:00", feeCents: 1500 },
  oneWayFeeCents: 2000,
  vatPercent: 24,
};

const loc = (id, over = {}) => ({
  id,
  name: { el: id, en: id },
  adjustmentType: "none",
  adjustmentValue: 0,
  adjustmentLabel: {},
  afterHoursFeeCents: null,
  allowPickup: true,
  allowDropoff: true,
  ...over,
});

const OFFICE = loc("office", {
  name: { el: "Γραφείο", en: "Office" },
  adjustmentType: "percent",
  adjustmentValue: -10,
  adjustmentLabel: { el: "Έκπτωση γραφείου 10%", en: "Office discount 10%" },
  afterHoursFeeCents: 0,
});
const AIRPORT = loc("airport", { deliveryFeeCents: 1000, collectionFeeCents: 1000 });
const PORT = loc("port", { deliveryFeeCents: 1500, collectionFeeCents: 1500 });

const AGES = [
  { minAge: 18, maxAge: 20, label: { el: "Κάτω των 21" }, allowed: false, isDefault: false, surchargeType: "none", surchargeCents: 0, surchargeMaxCents: null },
  { minAge: 21, maxAge: 22, label: { el: "Νέος οδηγός", en: "Young driver" }, allowed: true, isDefault: false, surchargeType: "per_day", surchargeCents: 800, surchargeMaxCents: 4000 },
  { minAge: 23, maxAge: 70, label: { el: "Οδηγός" }, allowed: true, isDefault: true, surchargeType: "none", surchargeCents: 0, surchargeMaxCents: null },
];

const base = (over = {}) => ({
  pickupAt: "2026-03-10T10:00",
  dropoffAt: "2026-03-13T10:00",
  target: TARGET,
  rates: RATES,
  seasons: SEASONS,
  ageBands: AGES,
  driverAge: 30,
  settings: SETTINGS,
  ...over,
});

const rentalOf = (r) => r.lines.filter((l) => l.kind === "rental").reduce((s, l) => s + l.totalCents, 0);

/* ── Βασικά ── */

test("3 ημέρες σε χαμηλή σεζόν", () => {
  const r = quote(base());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.days, 3);
  assert.equal(rentalOf(r), 3 * 3500);
  assert.equal(r.totalCents, 10500);
  assert.equal(r.avgDailyCents, 3500);
  assert.equal(r.vatCents, 10500 - Math.round(10500 / 1.24));
  assert.equal(r.depositCents, 30000);
  assert.equal(r.excessCents, 80000);
  assert.equal(r.discountBadge, null);
  assert.equal(r.listTotalCents, r.totalCents);
});

test("7 ημέρες που περνούν από μέση σε υψηλή σεζόν: σπάνε ανά ημέρα, κλίμακα από το σύνολο", () => {
  const r = quote(base({ pickupAt: "2026-06-27T10:00", dropoffAt: "2026-07-04T10:00" }));
  assert.equal(r.days, 7);
  const rental = r.lines.filter((l) => l.kind === "rental");
  assert.equal(rental.length, 2);
  // 27–30/6: μέση → «όλο τον χρόνο», κλίμακα 7+ = 40€ · 1–3/7: υψηλή, 7+ = 60€
  assert.deepEqual(rental.map((l) => [l.qty, l.unitCents]), [[4, 4000], [3, 6000]]);
  assert.equal(r.totalCents, 4 * 4000 + 3 * 6000);
  assert.match(rental[1].label.el, /Υψηλή/);
});

test("σεζόν Δεκ–Ιαν (περνά αλλαγή χρόνου) και κερδίζει την επικάλυψη με priority", () => {
  assert.equal(seasonFor("12-14", SEASONS).id, "low");
  assert.equal(seasonFor("12-20", SEASONS).id, "xmas");
  assert.equal(seasonFor("01-05", SEASONS).id, "xmas");
  assert.equal(seasonFor("01-11", SEASONS).id, "low");
  const r = quote(base({ pickupAt: "2026-12-30T10:00", dropoffAt: "2027-01-02T10:00" }));
  assert.equal(r.days, 3);
  assert.equal(rentalOf(r), 3 * 5000);
});

test("grace 59΄: ίδια ώρα +50΄ = ίδιες ημέρες, +70΄ = +1 ημέρα", () => {
  assert.equal(quote(base({ dropoffAt: "2026-03-13T10:50" })).days, 3);
  assert.equal(quote(base({ dropoffAt: "2026-03-13T11:10" })).days, 4);
  assert.equal(rentalDays(0, 30 * 60_000, 59), 1, "ελάχιστο 1");
});

test("αλλαγή ώρας (29/3, Αθήνα): 3 ημερολογιακές ημέρες μένουν 3", () => {
  assert.equal(quote(base({ pickupAt: "2026-03-28T10:00", dropoffAt: "2026-03-31T10:00" })).days, 3);
});

/* ── Τοποθεσίες ── */

test("γραφείο −10%: μόνο στο ενοίκιο, listTotal χωρίς την έκπτωση, σήμα «-10%»", () => {
  const r = quote(base({ pickupLocation: OFFICE }));
  assert.equal(r.ok, true);
  const disc = r.lines.find((l) => l.kind === "discount");
  assert.equal(disc.totalCents, -1050);
  assert.equal(disc.label.el, "Έκπτωση γραφείου 10%", "χωρίς διπλό «Έκπτωση:»");
  assert.equal(r.listTotalCents, 10500);
  assert.equal(r.discountCents, 1050);
  assert.equal(r.totalCents, 9450);
  assert.deepEqual(r.discountBadge, { el: "-10%", en: "-10%" });
  assert.equal(r.discounts.applied.source, "location");
});

test("γραφείο −10% με extra: η έκπτωση ΔΕΝ πιάνει τα extras", () => {
  const gps = { id: "gps", name: { el: "GPS" }, priceType: "per_rental", priceCents: 1000, maxTotalCents: null, maxQuantity: 1, vehicleTypes: [] };
  const r = quote(base({ pickupLocation: OFFICE, extras: [{ charge: gps, qty: 1 }] }));
  assert.equal(r.discountCents, 1050);
  assert.equal(r.totalCents, 10500 + 1000 - 1050);
});

test("επιστροφή σε άλλο σημείο: παράδοση στο ένα, παραλαβή από το άλλο + oneWayFee", () => {
  const r = quote(base({ pickupLocation: AIRPORT, dropoffLocation: PORT }));
  const kinds = r.lines.map((l) => [l.kind, l.totalCents]);
  assert.deepEqual(kinds.filter(([k]) => k !== "rental"), [["delivery", 1000], ["collection", 1500], ["one_way", 2000]]);
  assert.equal(r.totalCents, 10500 + 1000 + 1500 + 2000);
});

test("σημείο χωρίς επιστροφή → σφάλμα", () => {
  const r = quote(base({ pickupLocation: AIRPORT, dropoffLocation: loc("x", { allowDropoff: false }) }));
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, "LOCATION_NO_DROPOFF");
});

test("εκτός ωραρίου: δωρεάν στο γραφείο (0), προεπιλογή εταιρίας στο αεροδρόμιο", () => {
  const r = quote(
    base({ pickupAt: "2026-03-10T23:30", dropoffAt: "2026-03-13T06:00", pickupLocation: OFFICE, dropoffLocation: AIRPORT })
  );
  const ah = r.lines.filter((l) => l.kind === "after_hours");
  assert.equal(ah.length, 1, "μόνο η επιστροφή χρεώνεται");
  assert.equal(ah[0].totalCents, 1500);
  assert.match(ah[0].label.el, /Επιστροφή/);
  assert.equal(inWindow("07:00", "23:00", "07:00"), false);
  assert.equal(inWindow("06:59", "23:00", "07:00"), true);
});

/* ── Ηλικία ── */

test("νέος οδηγός: επιβάρυνση ανά ημέρα με ταβάνι", () => {
  const r = quote(base({ driverAge: 21, pickupAt: "2026-03-10T10:00", dropoffAt: "2026-03-17T10:00" }));
  const age = r.lines.find((l) => l.kind === "driver_age");
  assert.equal(age.qty, 7);
  assert.equal(age.totalCents, 4000, "7 × 8€ = 56€ → ταβάνι 40€");
  const short = quote(base({ driverAge: 22 }));
  assert.equal(short.lines.find((l) => l.kind === "driver_age").totalCents, 2400);
});

test("μη επιτρεπτή ηλικία / ηλικία εκτός bands → σφάλμα", () => {
  assert.equal(quote(base({ driverAge: 19 })).errors[0].code, "AGE_NOT_ALLOWED");
  const r = quote(base({ driverAge: 80 }));
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, "AGE_OUT_OF_RANGE");
  assert.ok(r.errors[0].message.el && r.errors[0].message.en);
});

test("χωρίς ηλικία → το προεπιλεγμένο band (καμία επιβάρυνση)", () => {
  const r = quote(base({ driverAge: null }));
  assert.equal(r.ok, true);
  assert.equal(r.lines.some((l) => l.kind === "driver_age"), false);
});

/* ── Extras / ασφάλεια ── */

test("extra ανά ημέρα με ταβάνι, πολλά τεμάχια, μόνο για τους τύπους του", () => {
  const seat = { id: "seat", name: { el: "Παιδικό κάθισμα", en: "Child seat" }, priceType: "per_day", priceCents: 500, maxTotalCents: 3000, maxQuantity: 2, vehicleTypes: ["car"] };
  const r = quote(base({ pickupAt: "2026-03-10T10:00", dropoffAt: "2026-03-20T10:00", extras: [{ charge: seat, qty: 2 }] }));
  const line = r.lines.find((l) => l.kind === "extra");
  assert.equal(line.totalCents, 2 * 3000, "10 × 5€ = 50€ → ταβάνι 30€ ανά τεμάχιο");
  assert.equal(quote(base({ extras: [{ charge: seat, qty: 3 }] })).errors[0].code, "EXTRA_QUANTITY");
  const moto = quote(base({ target: { ...TARGET, vehicleType: "moto" }, extras: [{ charge: seat, qty: 1 }] }));
  assert.equal(moto.errors[0].code, "EXTRA_NOT_FOR_VEHICLE");
});

test("ασφάλεια ανά ημέρα: γραμμή + η απαλλαγή της υπερισχύει", () => {
  const full = { id: "full", name: { el: "Πλήρης" }, priceType: "per_day", priceCents: 1200, maxTotalCents: null, maxQuantity: 1, vehicleTypes: [], excessCents: 0 };
  const r = quote(base({ insurance: full }));
  assert.equal(r.lines.find((l) => l.kind === "insurance").totalCents, 3600);
  assert.equal(r.excessCents, 0);
});

/* ── Κανόνες σεζόν / προθεσμίες ── */

test("minDays της σεζόν παραλαβής δεν καλύπτεται → σφάλμα με εξήγηση", () => {
  const r = quote(base({ pickupAt: "2026-07-10T10:00", dropoffAt: "2026-07-12T10:00" }));
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, "MIN_DAYS");
  assert.match(r.errors[0].message.el, /3 ημέρες.*Υψηλή/);
});

test("επιστροφή πριν την παραλαβή / άκυρη ημερομηνία → σφάλμα", () => {
  assert.equal(quote(base({ dropoffAt: "2026-03-09T10:00" })).errors[0].code, "INVALID_DATES");
  assert.equal(quote(base({ pickupAt: "2026-02-30T10:00" })).errors[0].code, "INVALID_DATES");
});

test("minLeadHours / maxAdvanceDays", () => {
  const now = new Date("2026-03-10T07:00:00Z"); // 09:00 Αθήνα
  const s = { ...SETTINGS, minLeadHours: 3, maxAdvanceDays: 365 };
  assert.equal(quote(base({ settings: s, now })).errors[0]?.code, "LEAD_TIME");
  assert.equal(quote(base({ settings: s, now, pickupAt: "2026-03-10T13:00" })).ok, true);
  assert.equal(quote(base({ settings: s, now, pickupAt: "2027-06-10T10:00", dropoffAt: "2027-06-13T10:00" })).errors[0]?.code, "TOO_FAR");
});

test("χωρίς rates → τιμή βάσης της ομάδας· χωρίς τιμή καθόλου → σφάλμα", () => {
  const r = quote(base({ rates: [] }));
  assert.equal(rentalOf(r), 3 * 9900);
  const zero = quote(base({ rates: [], target: { ...TARGET, basePriceCents: 0 } }));
  assert.equal(zero.errors[0].code, "NO_PRICE");
});

test("pickTier: κλίμακα από τις συνολικές ημέρες, με κενά", () => {
  const t = tiers(3500, 3000, 2600);
  assert.equal(pickTier(t, 3).dailyPriceCents, 3500);
  assert.equal(pickTier(t, 4).dailyPriceCents, 3000);
  assert.equal(pickTier(t, 30).dailyPriceCents, 2600);
  assert.equal(pickTier([{ minDays: 3, maxDays: null, dailyPriceCents: 1000 }], 1).dailyPriceCents, 1000);
  assert.equal(pickTier([], 3), null);
});

/* ── fromPrice ── */

test("fromPrice: η φθηνότερη ημερήσια τιμή των επόμενων 365 ημερών", () => {
  assert.equal(fromPrice(TARGET, RATES, SEASONS, "2026-03-01").dailyCents, 2600);
  // Μόνο υψηλή σεζόν ορατή μέσα σε 30 ημέρες από 1/7
  assert.equal(fromPrice(TARGET, RATES, SEASONS, "2026-07-01", { horizonDays: 30 }).dailyCents, 6000);
  assert.equal(fromPrice(TARGET, [], SEASONS, "2026-03-01").dailyCents, 9900, "χωρίς rates → βάση");
  assert.equal(fromPrice({ basePriceCents: 0 }, [], [], "2026-03-01"), null);
});

/* ── Χρήματα ── */

test("money: € ↔ cents σε ΕΝΑ σημείο", () => {
  assert.equal(toCents("35.50"), 3550);
  assert.equal(toCents({ toString: () => "12.3" }), 1230);
  assert.equal(toCents(null), 0);
  assert.equal(parseEuroInput("35,50"), 3550);
  assert.equal(parseEuroInput("35"), 3500);
  assert.equal(parseEuroInput("1.234,5"), 123450);
  assert.equal(parseEuroInput(""), null);
  assert.ok(Number.isNaN(parseEuroInput("abc")));
  assert.ok(Number.isNaN(parseEuroInput("3,555")));
  assert.equal(centsToInput(3550), "35,50");
  assert.equal(centsToInput(3500), "35");
});


/* ══ Χρεώσεις δρομολογίου (SQL 21c) ══ */

const HER = loc("her", {
  name: { el: "Αεροδρόμιο Ηρακλείου", en: "Heraklion Airport" },
  deliveryFeeCents: 5000,
  collectionFeeCents: 5000,
  feeLabel: { el: "Ηράκλειο", en: "Heraklion" },
});

test("παράδοση ΚΑΙ παραλαβή στο Ηράκλειο: δύο γραμμές (δύο δρομολόγια)", () => {
  const r = quote(base({ pickupLocation: HER, dropoffLocation: HER }));
  const route = r.lines.filter((l) => l.kind === "delivery" || l.kind === "collection");
  assert.deepEqual(route.map((l) => [l.kind, l.totalCents]), [["delivery", 5000], ["collection", 5000]]);
  assert.equal(route[0].label.el, "Παράδοση: Ηράκλειο");
  assert.equal(route[1].label.el, "Παραλαβή: Ηράκλειο");
  assert.equal(r.lines.some((l) => l.kind === "one_way"), false, "ίδιο σημείο = όχι oneWay");
  assert.equal(r.totalCents, 10500 + 10000);
});

test("χωρίς σημείο επιστροφής = ίδιο με την παραλαβή (δύο δρομολόγια)", () => {
  const r = quote(base({ pickupLocation: HER }));
  assert.equal(r.lines.filter((l) => l.kind === "delivery" || l.kind === "collection").length, 2);
});

test("παράδοση σε Ηράκλειο, επιστροφή σε σημείο χωρίς χρέωση: μόνο η παράδοση", () => {
  const r = quote(base({ pickupLocation: HER, dropoffLocation: loc("chq") }));
  assert.deepEqual(r.lines.filter((l) => ["delivery", "collection"].includes(l.kind)).map((l) => l.totalCents), [5000]);
});

test("feeFreeFromDays: από 7 ημέρες οι χρεώσεις δρομολογίου γίνονται 0 με ένδειξη", () => {
  const free = { ...HER, feeFreeFromDays: 7 };
  const short = quote(base({ pickupLocation: free }));
  assert.equal(short.lines.find((l) => l.kind === "delivery").totalCents, 5000);
  const long = quote(base({ pickupLocation: free, dropoffAt: "2026-03-17T10:00" }));
  const route = long.lines.filter((l) => l.kind === "delivery" || l.kind === "collection");
  assert.deepEqual(route.map((l) => l.totalCents), [0, 0]);
  assert.match(route[0].label.el, /Δωρεάν από 7 ημέρες/);
});

test("μεταφορά παλιού 'fixed' (θετικό) → παράδοση + παραλαβή, ίδιος κανόνας με το SQL 21c", () => {
  const old = { adjustmentType: "fixed", adjustmentValue: 5000, adjustmentLabel: { el: "Παράδοση στο Ηράκλειο" }, deliveryFeeCents: 0, collectionFeeCents: 0, feeLabel: {} };
  const m = migrateLegacyFixed(old);
  assert.equal(m.deliveryFeeCents, 5000);
  assert.equal(m.collectionFeeCents, 5000);
  assert.deepEqual(m.feeLabel, { el: "Παράδοση στο Ηράκλειο" });
  assert.equal(m.adjustmentType, "none");
  assert.equal(m.adjustmentValue, 0);
  assert.equal(migrateLegacyFixed({ ...old, adjustmentType: "percent", adjustmentValue: -10 }).adjustmentType, "percent");
  assert.equal(migrateLegacyFixed({ ...old, adjustmentValue: -500 }).adjustmentType, "fixed", "αρνητικό: δεν μεταφέρεται");
});

/* ══ Προσφορές (SQL 21c) ══ */

const GROUP_TARGET = { ...TARGET, rentalGroupId: "grpA", vehicleId: null };

const promo = (over = {}) => ({
  id: "p1",
  name: { el: "Φθινόπωρο" },
  badge: { el: "Προσφορά φθινοπώρου", en: "Autumn offer" },
  isActive: true,
  discountType: "percent",
  discountValue: 15,
  validFrom: "2026-03-01",
  validTo: "2026-03-31",
  locationIds: [],
  locationMatch: "pickup",
  rentalGroupIds: [],
  vehicleIds: [],
  vehicleTypes: [],
  minDays: null,
  sortOrder: 0,
  ...over,
});

const pq = (over = {}) => quote(base({ target: GROUP_TARGET, ...over }));

test("προσφορά -15%: μία αρνητική γραμμή, διαγραμμένη τιμή και σήμα", () => {
  const r = pq({ promotions: [promo()] });
  const d = r.lines.find((l) => l.kind === "discount");
  assert.equal(d.totalCents, -Math.round(10500 * 0.15));
  assert.equal(d.label.el, "Έκπτωση: Προσφορά φθινοπώρου");
  assert.equal(r.listTotalCents, 10500);
  assert.deepEqual(r.discountBadge, { el: "-15%", en: "-15%" });
  assert.equal(r.discounts.applied.id, "p1");
});

test("προσφορά μόνο σε μία ομάδα: ισχύει για αυτήν, όχι για άλλη", () => {
  assert.equal(pq({ promotions: [promo({ rentalGroupIds: ["grpA"] })] }).discountCents, 1575);
  assert.equal(pq({ promotions: [promo({ rentalGroupIds: ["grpB"] })] }).discountCents, 0);
  assert.equal(pq({ promotions: [promo({ rentalGroupIds: ["grpB"], vehicleTypes: ["car"] })] }).discountCents, 1575, "αρκεί ΕΝΑ από τα κριτήρια");
});

test("προσφορά που καλύπτει μόνο μερικές ημέρες: έκπτωση μόνο σε αυτές", () => {
  // 10–12/3 (3 ημέρες × 35€)· η προσφορά ισχύει 12/3–31/3 → μόνο η 3η ημέρα
  const r = pq({ promotions: [promo({ validFrom: "2026-03-12" })] });
  assert.equal(r.discountCents, Math.round(3500 * 0.15));
});

test("per_day: ποσό × ημέρες μέσα στο διάστημα, ποτέ κάτω από 0 ανά ημέρα", () => {
  assert.equal(pq({ promotions: [promo({ discountType: "per_day", discountValue: 500 })] }).discountCents, 1500);
  assert.equal(pq({ promotions: [promo({ discountType: "per_day", discountValue: 500, validFrom: "2026-03-11" })] }).discountCents, 1000);
  assert.equal(pq({ promotions: [promo({ discountType: "per_day", discountValue: 99999 })] }).discountCents, 10500);
});

test("per_rental: μία φορά· το σήμα είναι το κείμενο της προσφοράς", () => {
  const r = pq({ promotions: [promo({ discountType: "per_rental", discountValue: 2000 })] });
  assert.equal(r.discountCents, 2000);
  assert.deepEqual(r.discountBadge, { el: "Προσφορά φθινοπώρου", en: "Autumn offer" });
});

test("minDays: κάτω από το όριο δεν ισχύει", () => {
  assert.equal(pq({ promotions: [promo({ minDays: 4 })] }).discountCents, 0);
  assert.equal(pq({ promotions: [promo({ minDays: 3 })] }).discountCents, 1575);
});

test("τοποθεσία επιστροφής (locationMatch 'dropoff')", () => {
  const p = promo({ locationIds: ["port"], locationMatch: "dropoff" });
  assert.equal(pq({ promotions: [p], pickupLocation: AIRPORT, dropoffLocation: PORT }).discountCents, 1575);
  assert.equal(pq({ promotions: [p], pickupLocation: PORT, dropoffLocation: AIRPORT }).discountCents, 0);
  const either = promo({ locationIds: ["port"], locationMatch: "either" });
  assert.equal(pq({ promotions: [either], pickupLocation: PORT, dropoffLocation: AIRPORT }).discountCents, 1575);
  const pick = promo({ locationIds: ["port"], locationMatch: "pickup" });
  assert.equal(pq({ promotions: [pick], pickupLocation: AIRPORT, dropoffLocation: PORT }).discountCents, 0);
});

test("χωρίς άθροισμα: γραφείο -10% vs προσφορά -15% → κερδίζει η μεγαλύτερη, η άλλη φαίνεται ως «έχασε»", () => {
  const r = pq({ pickupLocation: OFFICE, promotions: [promo()] });
  assert.equal(r.lines.filter((l) => l.kind === "discount").length, 1);
  assert.equal(r.discountCents, 1575);
  assert.equal(r.discounts.applied.source, "promotion");
  assert.deepEqual(r.discounts.others.map((o) => [o.source, o.amountCents]), [["location", 1050]]);
  const small = pq({ pickupLocation: OFFICE, promotions: [promo({ discountValue: 5 })] });
  assert.equal(small.discounts.applied.source, "location");
  assert.equal(small.discountCents, 1050);
});

test("ισοπαλία: κερδίζει η μικρότερη sortOrder", () => {
  const r = pq({ promotions: [promo({ id: "b", sortOrder: 5 }), promo({ id: "a", sortOrder: 1 })] });
  assert.equal(r.discounts.applied.id, "a");
  assert.equal(r.discounts.others[0].id, "b");
});

test("ανενεργή ή ληγμένη προσφορά δεν ισχύει", () => {
  assert.equal(pq({ promotions: [promo({ isActive: false })] }).discountCents, 0);
  assert.equal(pq({ promotions: [promo({ validFrom: "2025-01-01", validTo: "2025-12-31" })] }).discountCents, 0);
  assert.equal(pq({ promotions: [promo({ validFrom: "2026-04-01", validTo: "2026-04-30" })] }).discountCents, 0);
});

test("extras, ασφάλεια, ηλικία και χρεώσεις δρομολογίου ΔΕΝ εκπτώνονται", () => {
  const gps = { id: "gps", name: { el: "GPS" }, priceType: "per_rental", priceCents: 1000, maxTotalCents: null, maxQuantity: 1, vehicleTypes: [] };
  const ins = { id: "ins", name: { el: "Πλήρης" }, priceType: "per_day", priceCents: 1000, maxTotalCents: null, maxQuantity: 1, vehicleTypes: [] };
  const r = pq({
    promotions: [promo({ discountValue: 50 })],
    pickupLocation: HER,
    extras: [{ charge: gps, qty: 1 }],
    insurance: ins,
    driverAge: 21,
  });
  assert.equal(r.discountCents, Math.round(10500 * 0.5), "μόνο το ενοίκιο");
  const notRental = r.lines.filter((l) => !["rental", "discount"].includes(l.kind)).reduce((s, l) => s + l.totalCents, 0);
  assert.equal(r.totalCents, 10500 - 5250 + notRental);
  assert.equal(r.listTotalCents, r.totalCents + r.discountCents);
});

test("fromPrice: προσφορά χωρίς τοποθεσία μετρά (με badge)· με τοποθεσία όχι", () => {
  const r = fromPrice(GROUP_TARGET, RATES, SEASONS, "2026-03-01", { promotions: [promo({ discountValue: 50 })] });
  assert.equal(r.dailyCents, 1300, "2600 × 50%");
  assert.equal(r.listDailyCents, 2600);
  assert.deepEqual(r.badge, { el: "-50%", en: "-50%" });
  const withLoc = fromPrice(GROUP_TARGET, RATES, SEASONS, "2026-03-01", { promotions: [promo({ discountValue: 50, locationIds: ["office"] })] });
  assert.equal(withLoc.dailyCents, 2600);
  assert.equal(withLoc.badge, null);
});
