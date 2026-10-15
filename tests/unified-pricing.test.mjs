// tests/unified-pricing.test.mjs
// Ενιαία τιμολόγηση: στρογγυλοποίηση της quote() (ακέραιο €), ΙΣΟΤΗΤΑ
// dashboard ↔ δημόσιο site (ίδια μηχανή engine.ts), αλλαγή ρύθμισης, tenant
// isolation, χειροκίνητη τιμή. Τρέχει με `npm test` (node:test), χωρίς βάση.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const { quote, fromPrice } = await import("../src/lib/public/pricing.ts");
const { roundToEuro, perDayOf } = await import("../src/lib/public/money.ts");
const { quoteFromContext, requestFromCriteria, requestFromBooking, matchLocation, ageAt, hasUnpricedDay } = await import(
  "../src/lib/public/engine.ts"
);
const { toPriceBreakdown, toStoredQuote, manualDiscountCents } = await import("../src/lib/pricingBridge.ts");
const { decidePriceOverride, overrideIsStale, totalWithRental } = await import("../src/lib/priceOverride.ts");

/* ─────────────────────────────────────────────
   Δεδομένα: μία εταιρία όπως τη φορτώνει το loadQuoteContext
   ───────────────────────────────────────────── */

const tiers = (a, b, c) => [
  { minDays: 1, maxDays: 3, dailyPriceCents: a },
  { minDays: 4, maxDays: 6, dailyPriceCents: b },
  { minDays: 7, maxDays: null, dailyPriceCents: c },
];

const loc = (id, slug, el, en, extra = {}) => ({
  id, slug, name: { el, en }, adjustmentType: "none", adjustmentValue: 0, adjustmentLabel: {},
  afterHoursFeeCents: null, allowPickup: true, allowDropoff: true, isActive: true,
  deliveryFeeCents: 0, collectionFeeCents: 0, feeFreeFromDays: null, feeLabel: {}, ...extra,
});

function makeCtx(over = {}) {
  const groupTarget = { vehicleType: "car", rentalGroupId: "grpA", vehicleId: null, basePriceCents: 3000, depositCents: 30000, excessCents: 80000, minDriverAge: 21 };
  return {
    settings: {
      timezone: "Europe/Athens", graceMinutes: 59, afterHours: { start: "23:00", end: "07:00", feeCents: 2000 },
      oneWayFeeCents: 1500, minLeadHours: 3, maxAdvanceDays: 365, vatPercent: 24,
    },
    seasons: [
      { id: "low", name: { el: "Χαμηλή", en: "Low" }, startMonthDay: "10-16", endMonthDay: "04-30", minDays: null, priority: 0 },
      { id: "high", name: { el: "Υψηλή", en: "High" }, startMonthDay: "05-01", endMonthDay: "10-15", minDays: null, priority: 0 },
    ],
    locations: [
      loc("L1", "chania-airport", "Αεροδρόμιο Χανίων", "Chania Airport", { deliveryFeeCents: 1000, collectionFeeCents: 1000 }),
      loc("L2", "souda-port", "Λιμάνι Σούδας", "Souda Port"),
      loc("L3", "office", "Γραφείο", "Office", { adjustmentType: "percent", adjustmentValue: -10, adjustmentLabel: { el: "Γραφείο -10%" } }),
    ],
    ageBands: [
      { minAge: 21, maxAge: 24, label: { el: "Νέος οδηγός" }, explanation: {}, allowed: true, isDefault: false, surchargeType: "per_day", surchargeCents: 333, surchargeMaxCents: null },
      { minAge: 25, maxAge: 70, label: {}, explanation: {}, allowed: true, isDefault: true, surchargeType: "none", surchargeCents: 0, surchargeMaxCents: null },
    ],
    promotions: [],
    extras: [
      { id: "gps", kind: "EXTRA", isActive: true, isDefault: false, name: { el: "GPS" }, priceType: "per_rental", priceCents: 450, maxTotalCents: null, maxQuantity: 1, vehicleTypes: [] },
      { id: "basic", kind: "INSURANCE", isActive: true, isDefault: true, name: { el: "Βασική" }, priceType: "per_day", priceCents: 0, maxTotalCents: null, maxQuantity: 1, vehicleTypes: [], excessCents: 80000 },
    ],
    groups: new Map([["grpA", { target: groupTarget, rates: [{ seasonId: "low", tiers: tiers(3333, 3000, 2600) }, { seasonId: "high", tiers: tiers(5500, 5000, 4500) }] }]]),
    vehicles: new Map([
      ["veh1", { target: { vehicleType: "car", rentalGroupId: "grpA", vehicleId: "veh1", basePriceCents: 3500, depositCents: null, excessCents: null, minDriverAge: null }, rates: [] }],
      ["solo", { target: { vehicleType: "car", rentalGroupId: null, vehicleId: "solo", basePriceCents: 4250, depositCents: null, excessCents: null, minDriverAge: null }, rates: [] }],
    ]),
    ...over,
  };
}

const GROUPS = [{ id: "grpA", code: "A" }];

const sumLines = (r) => r.lines.reduce((s, l) => s + l.totalCents, 0);

/* ─────────────────────────────────────────────
   1. Στρογγυλοποίηση
   ───────────────────────────────────────────── */

test("roundToEuro: half up, και για αρνητικά (εκπτώσεις)", () => {
  assert.equal(roundToEuro(1250), 1300);
  assert.equal(roundToEuro(1249), 1200);
  assert.equal(roundToEuro(-1250), -1300);
  assert.equal(roundToEuro(-1249), -1200);
  assert.equal(roundToEuro(1249.9999999), 1200);
  assert.equal(roundToEuro(0), 0);
});

test("έκπτωση % που δίνει λεπτά → ακέραιο €, σύνολο ακέραιο, γραμμές = σύνολο", () => {
  const ctx = makeCtx();
  // 3 ημέρες χαμηλή × 33,33 = 99,99 € · γραφείο −10% = 9,999 → 10 €
  const r = quoteFromContext(ctx, { target: { kind: "group", id: "grpA" }, pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-05T10:00", pickupLocationId: "L3", insuranceId: null }).result;
  const disc = r.lines.find((l) => l.kind === "discount");
  assert.equal(disc.totalCents, -1000);
  assert.equal(r.totalCents % 100, 0);
  assert.equal(sumLines(r), r.totalCents, "οι γραμμές αθροίζουν ΑΚΡΙΒΩΣ στο σύνολο");
  assert.equal(r.listTotalCents, r.totalCents + r.discountCents);
  assert.equal(r.listTotalCents % 100, 0);
  // 99,99 − 10 = 89,99 → στρογγυλοποίηση +0,01
  const rounding = r.lines.find((l) => l.kind === "rounding");
  assert.equal(rounding.totalCents, 1);
  assert.equal(r.totalCents, 9000);
});

test("επιβάρυνση ηλικίας με λεπτά → ακέραιο € (γραμμή), σύνολο ακέραιο", () => {
  const ctx = makeCtx();
  // 3 × 3,33 = 9,99 → 10 €
  const r = quoteFromContext(ctx, { target: { kind: "group", id: "grpA" }, pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-05T10:00", driverAge: 22, insuranceId: null }).result;
  assert.equal(r.lines.find((l) => l.kind === "driver_age").totalCents, 1000);
  assert.equal(r.totalCents % 100, 0);
  assert.equal(sumLines(r), r.totalCents);
});

test("extra με λεπτά (4,50 €) → γραμμή «Στρογγυλοποίηση» < 1 €, μόνο όταν χρειάζεται", () => {
  const ctx = makeCtx();
  const base = { target: { kind: "vehicle", id: "solo" }, pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-04T10:00", insuranceId: null };
  const noExtra = quoteFromContext(ctx, base).result;
  assert.equal(noExtra.totalCents, 8500);
  assert.ok(!noExtra.lines.some((l) => l.kind === "rounding"), "χωρίς λεπτά → καμία γραμμή στρογγυλοποίησης");
  const withGps = quoteFromContext(ctx, { ...base, extras: [{ id: "gps", qty: 1 }] }).result;
  const rounding = withGps.lines.find((l) => l.kind === "rounding");
  assert.equal(rounding.totalCents, 50, "89,50 → 90");
  assert.equal(rounding.label.el, "Στρογγυλοποίηση");
  assert.ok(Math.abs(rounding.totalCents) < 100);
  assert.equal(withGps.totalCents, 9000);
  assert.equal(sumLines(withGps), withGps.totalCents);
});

test("σύγκριση προσφορών στα στρογγυλοποιημένα ποσά (ισοπαλία → sortOrder)", () => {
  const promo = (id, pct, sortOrder) => ({
    id, name: { el: id }, badge: { el: id }, isActive: true, discountType: "percent", discountValue: pct,
    validFrom: "2026-01-01", validTo: "2026-12-31", locationIds: [], locationMatch: "pickup",
    rentalGroupIds: [], vehicleIds: [], vehicleTypes: [], minDays: null, sortOrder,
  });
  // 99,99 €: 10% = 9,999 → 10 · 10,4% = 10,399 → 10 → ισοπαλία, κερδίζει η μικρότερη sortOrder
  const ctx = makeCtx({ promotions: [promo("p104", 10.4, 2), promo("p10", 10, 1)] });
  const r = quoteFromContext(ctx, { target: { kind: "group", id: "grpA" }, pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-05T10:00", insuranceId: null }).result;
  assert.equal(r.discounts.applied.id, "p10");
  assert.equal(r.discounts.applied.amountCents, 1000);
  assert.equal(r.discounts.others[0].amountCents, 1000);
});

test("€/ημέρα = σύνολο ÷ ημέρες στο πλησιέστερο €, «~» όταν δεν είναι ακριβές", () => {
  assert.deepEqual(perDayOf(9000, 3), { cents: 3000, approx: false });
  assert.deepEqual(perDayOf(10000, 3), { cents: 3300, approx: true });
  const r = quote({
    pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-05T10:00",
    target: { vehicleType: "car", basePriceCents: 3333, depositCents: null, excessCents: null },
    rates: [], seasons: [], ageBands: [], settings: makeCtx().settings,
  });
  assert.equal(r.totalCents, 10000);
  assert.equal(r.avgDailyCents, 3300);
});

test("fromPrice: «από X €/ημέρα» σε ακέραιο €", () => {
  const ctx = makeCtx();
  const g = ctx.groups.get("grpA");
  const fp = fromPrice(g.target, g.rates, ctx.seasons, "2026-11-01", { horizonDays: 30 });
  assert.equal(fp.dailyCents, 2600, "26,00");
  const fp2 = fromPrice({ basePriceCents: 3333 }, [], [], "2026-11-01", { horizonDays: 5 });
  assert.equal(fp2.dailyCents, 3300);
  assert.equal(fp2.dailyCents % 100, 0);
});

/* ─────────────────────────────────────────────
   2. ΙΣΟΤΗΤΑ dashboard ↔ site (golden, ίδια μηχανή)
   ───────────────────────────────────────────── */

const promo15 = {
  id: "p15", name: { el: "Φθινόπωρο" }, badge: { el: "-15%" }, isActive: true, discountType: "percent", discountValue: 15,
  validFrom: "2026-10-01", validTo: "2026-12-15", locationIds: [], locationMatch: "pickup",
  rentalGroupIds: ["grpA"], vehicleIds: [], vehicleTypes: [], minDays: 3, sortOrder: 0,
};

const SCENARIOS = [
  { name: "χωρίς προσφορά", ctx: {}, site: { pl: "chania-airport", dl: null, from: "2026-11-02T10:00", to: "2026-11-05T10:00", age: 30 }, dash: { pickupLocation: "Αεροδρόμιο Χανίων", returnLocation: "", birth: "1996-01-01" } },
  { name: "με προσφορά -15%", ctx: { promotions: [promo15] }, site: { pl: "chania-airport", dl: null, from: "2026-11-02T10:00", to: "2026-11-09T10:00", age: 30 }, dash: { pickupLocation: "αεροδρομιο χανιων", returnLocation: null, birth: "1990-06-15" } },
  { name: "εκτός ωραρίου", ctx: {}, site: { pl: "souda-port", dl: null, from: "2026-11-02T23:30", to: "2026-11-05T06:30", age: 40 }, dash: { pickupLocation: "Λιμάνι Σούδας", returnLocation: "", birth: "1986-01-01" } },
  { name: "επιστροφή σε άλλη τοποθεσία", ctx: {}, site: { pl: "chania-airport", dl: "souda-port", from: "2026-11-02T10:00", to: "2026-11-06T10:00", age: 30 }, dash: { pickupLocation: "Chania Airport", returnLocation: "Λιμάνι Σούδας", birth: "1996-01-01" } },
  { name: "ηλικία εκτός κλίμακας", ctx: {}, site: { pl: "office", dl: null, from: "2026-11-02T10:00", to: "2026-11-05T10:00", age: 19 }, dash: { pickupLocation: "Γραφείο", returnLocation: "", birth: "2007-06-01" } },
  { name: "πολλές σεζόν (υψηλή → χαμηλή)", ctx: {}, site: { pl: null, dl: null, from: "2026-10-12T10:00", to: "2026-10-20T12:00", age: 23 }, dash: { pickupLocation: "", returnLocation: "", birth: "2003-01-01" } },
];

for (const sc of SCENARIOS) {
  test(`ΙΣΟΤΗΤΑ: ${sc.name}`, () => {
    const ctx = makeCtx(sc.ctx);
    const siteReq = requestFromCriteria(ctx, GROUPS, "g.A", sc.site);
    const dashReq = requestFromBooking(ctx, {
      vehicleId: "veh1",
      pickupDate: sc.site.from.slice(0, 10),
      pickupTime: sc.site.from.slice(11),
      returnDate: sc.site.to.slice(0, 10),
      returnTime: sc.site.to.slice(11),
      pickupLocation: sc.dash.pickupLocation,
      returnLocation: sc.dash.returnLocation,
      driverBirthDate: sc.dash.birth,
      extraIds: [],
    });
    const site = quoteFromContext(ctx, siteReq).result;
    const dash = quoteFromContext(ctx, dashReq).result;
    assert.deepEqual(dash, site, "ίδια ανάλυση, ίδιο σύνολο");
    assert.equal(site.totalCents % 100, 0);
    if (site.ok) assert.equal(sumLines(site), site.totalCents);
  });
}

test("ΙΣΟΤΗΤΑ: συγκεκριμένα αποτελέσματα των σεναρίων (ελέγχει ότι μετρούν όντως)", () => {
  const ctx = makeCtx({ promotions: [promo15] });
  const r = (s) => quoteFromContext(ctx, requestFromCriteria(ctx, GROUPS, "g.A", s)).result;
  assert.ok(r(SCENARIOS[1].site).discountCents > 0, "προσφορά");
  assert.ok(r(SCENARIOS[2].site).lines.some((l) => l.kind === "after_hours"), "εκτός ωραρίου");
  assert.ok(r(SCENARIOS[3].site).lines.some((l) => l.kind === "one_way"), "άλλη τοποθεσία");
  assert.equal(r(SCENARIOS[4].site).errors[0].code, "AGE_OUT_OF_RANGE");
  const seasons = r(SCENARIOS[5].site).lines.filter((l) => l.kind === "rental").map((l) => l.label.en);
  assert.ok(seasons.some((x) => /High/.test(x)) && seasons.some((x) => /Low/.test(x)), "δύο σεζόν");
});

test("Δοκιμαστικός υπολογισμός = site: ίδια μηχανή με προεπιλεγμένη ασφάλεια", () => {
  const ctx = makeCtx();
  const viaTest = quoteFromContext(ctx, { target: { kind: "group", id: "grpA" }, pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-05T10:00", pickupLocationId: "L1", driverAge: 30, insuranceId: "basic" }).result;
  const viaSite = quoteFromContext(ctx, requestFromCriteria(ctx, GROUPS, "g.A", { pl: "chania-airport", dl: null, from: "2026-11-02T10:00", to: "2026-11-05T10:00", age: 30 })).result;
  assert.deepEqual(viaTest, viaSite);
});

test("αλλαγή ρύθμισης (τιμή σεζόν) αλλάζει ΚΑΙ τα δύο αποτελέσματα", () => {
  const before = makeCtx();
  const after = makeCtx();
  after.groups.get("grpA").rates[0].tiers = tiers(4000, 3500, 3000);
  const sc = SCENARIOS[0];
  const run = (ctx) => [
    quoteFromContext(ctx, requestFromCriteria(ctx, GROUPS, "g.A", sc.site)).result.totalCents,
    quoteFromContext(ctx, requestFromBooking(ctx, { vehicleId: "veh1", pickupDate: "2026-11-02", pickupTime: "10:00", returnDate: "2026-11-05", returnTime: "10:00", pickupLocation: sc.dash.pickupLocation, driverBirthDate: sc.dash.birth, extraIds: [] })).result.totalCents,
  ];
  const [s1, d1] = run(before);
  const [s2, d2] = run(after);
  assert.equal(s1, d1);
  assert.equal(s2, d2);
  assert.notEqual(s1, s2);
  assert.equal(s2 - s1, 2000, "3 × 40 € αντί για 3 × 33,33 € (= 100 € μετά τη στρογγυλοποίηση)");
});

test("tenant isolation: ομάδα/όχημα/τοποθεσία άλλης εταιρίας δεν υπάρχουν στο ctx → καμία τιμή", () => {
  const ctx = makeCtx();
  assert.deepEqual(quoteFromContext(ctx, { target: { kind: "group", id: "grpOTHER" }, pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-05T10:00" }), { ok: false, reason: "not_found" });
  assert.deepEqual(quoteFromContext(ctx, { target: { kind: "vehicle", id: "vehOTHER" }, pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-05T10:00" }), { ok: false, reason: "not_found" });
  // Τοποθεσία άλλης εταιρίας: αγνοείται (δεν φέρνει χρεώσεις/εκπτώσεις)
  const a = quoteFromContext(ctx, { target: { kind: "group", id: "grpA" }, pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-05T10:00", pickupLocationId: "L_OTHER" }).result;
  const b = quoteFromContext(ctx, { target: { kind: "group", id: "grpA" }, pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-05T10:00" }).result;
  assert.deepEqual(a, b);
  // Extra άλλης εταιρίας: αγνοείται
  const c = quoteFromContext(ctx, { target: { kind: "group", id: "grpA" }, pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-05T10:00", extras: [{ id: "extra_OTHER", qty: 1 }] }).result;
  assert.deepEqual(c, b);
});

test("βοηθητικά dashboard: σημείο κατά όνομα/slug, ηλικία στην ημέρα παραλαβής", () => {
  const ctx = makeCtx();
  assert.equal(matchLocation("  Αεροδρόμιο   ΧΑΝΙΩΝ ", ctx.locations), "L1");
  assert.equal(matchLocation("chania-airport", ctx.locations), "L1");
  assert.equal(matchLocation("Ξενοδοχείο πελάτη", ctx.locations), null);
  assert.equal(ageAt("1996-11-03", "2026-11-02"), 29);
  assert.equal(ageAt("1996-11-02", "2026-11-02"), 30);
  assert.equal(ageAt("", "2026-11-02"), null);
});

test("χωρίς τιμή για κάποια ημέρα → hasUnpricedDay (dashboard: χειροκίνητη)", () => {
  const ctx = makeCtx();
  ctx.vehicles.get("solo").target.basePriceCents = 0;
  const r = quoteFromContext(ctx, { target: { kind: "vehicle", id: "solo" }, pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-04T10:00" }).result;
  assert.equal(hasUnpricedDay(r), true);
});

/* ─────────────────────────────────────────────
   3. Γέφυρα προς κράτηση + χειροκίνητη τιμή
   ───────────────────────────────────────────── */

test("κράτηση από quote(): subtotal + extras + ασφάλεια − έκπτωση = σύνολο (ακέραιο), κωδικός σε ακέραιο €", () => {
  const ctx = makeCtx();
  const r = quoteFromContext(ctx, { target: { kind: "vehicle", id: "solo" }, pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-04T10:00", extras: [{ id: "gps", qty: 1 }], insuranceId: "basic" }).result;
  const manual = manualDiscountCents(7.4, r.totalCents);
  assert.equal(manual, 700, "7,40 € κωδικός → 7 €");
  const b = toPriceBreakdown(r, { manualDiscountCents: manual });
  assert.equal(Math.round((b.subtotal + b.extrasTotal + b.insuranceCost - b.discountAmount) * 100), Math.round(b.total * 100));
  assert.equal(b.total, 83);
  assert.equal(b.extrasTotal, 4.5);
  assert.equal(b.lines.find((l) => l.id === "gps").lineTotal, 4.5);
  const stored = toStoredQuote(r, { cents: manual, code: "AUTUMN" }, true);
  assert.equal(stored.totalCents, 8300);
  assert.equal(stored.autoPrice, true);
  assert.deepEqual(stored.quote.lines, r.lines, "ΟΛΟΚΛΗΡΗ η ανάλυση αποθηκεύεται");
});

test("χειροκίνητη τιμή: δεν γράφεται πάνω από νέα αυτόματη, η σημαία (override) αποθηκεύεται", () => {
  const parts = { subtotal: 100, extrasTotal: 4.5, insuranceCost: 0, discountAmount: 0 };
  const manual = decidePriceOverride({
    requested: { rental: 80, reason: "τακτικός πελάτης" },
    canPrice: true, lock: null, parts, roundUpTotal: false,
    actor: { userId: "u1", userName: "Admin" }, now: new Date("2026-10-15T08:00:00Z"),
  });
  assert.equal(manual.ok, true);
  assert.equal(manual.override.manualRental, 80, "χειροκίνητη → σημαία override");
  assert.equal(manual.total, 84.5);
  // Αλλάζουν ημερομηνίες: η αυτόματη τιμή γίνεται 120, η χειροκίνητη ΜΕΝΕΙ (μόνο ειδοποίηση).
  assert.equal(overrideIsStale(manual.override, 120), true, "«Η αυτόματη τιμή είναι X €» με κουμπί «Χρήση»");
  assert.equal(totalWithRental({ ...parts, subtotal: 120 }, manual.override.manualRental), 84.5, "το σύνολο κρατά το χειροκίνητο ενοίκιο");
  // «Επαναφορά στην αυτόματη» / «Χρήση»: χωρίς override, σύνολο = αυτόματο.
  const reset = decidePriceOverride({
    requested: null, canPrice: true, lock: null, parts, roundUpTotal: false,
    actor: { userId: "u1", userName: "Admin" }, now: new Date(),
  });
  assert.equal(reset.override, null);
  assert.equal(reset.total, 104.5);
});
