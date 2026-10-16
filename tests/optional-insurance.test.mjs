// tests/optional-insurance.test.mjs
// Ασφάλεια = ΠΡΟΑΙΡΕΤΙΚΗ επιλογή του πελάτη · «Επίπεδα ασφάλειας» ανά εταιρία
// (SQL 25). Μηχανή (quote/engine), ισότητα dashboard ↔ site, απορρίψεις,
// επιλογές του site, snapshot στο priceQuote, διαχείριση επιπέδων. Χωρίς βάση.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const { quoteFromContext, requestFromCriteria, requestFromBooking, insuranceLevelsFor, INSURANCE_INVALID_MESSAGE } = await import(
  "../src/lib/public/engine.ts"
);
const { chargeTotalCents } = await import("../src/lib/public/pricing.ts");
const { insuranceOptions, extraOptions } = await import("../src/lib/public/bookingView.ts");
const { toStoredQuote, storedInsurance, toPriceBreakdown } = await import("../src/lib/pricingBridge.ts");
const { toConfirmationDTO } = await import("../src/lib/public/bookingRequest.ts");
const { buildBookingMessage } = await import("../src/lib/bookingMessages.ts");
const { insuranceLevelSchema, deleteActionFor, moveLevel } = await import("../src/lib/public/insuranceLevels.ts");
const { readLocalizedList, textFor } = await import("../src/lib/public/text.ts");

/* ─────────────────────────────────────────────
   Δεδομένα μιας εταιρίας (όπως το loadQuoteContext)
   ───────────────────────────────────────────── */

const tiers = (a, b, c) => [
  { minDays: 1, maxDays: 3, dailyPriceCents: a },
  { minDays: 4, maxDays: 7, dailyPriceCents: b },
  { minDays: 8, maxDays: null, dailyPriceCents: c },
];
const loc = (id, slug, el, en) => ({
  id, slug, name: { el, en }, isActive: true, needsFlight: false, adjustmentType: "none", adjustmentValue: 0, adjustmentLabel: {},
  afterHoursFeeCents: null, allowPickup: true, allowDropoff: true, deliveryFeeCents: 0, collectionFeeCents: 0, feeFreeFromDays: null, feeLabel: {},
});
const level = (id, over = {}) => ({
  id, kind: "INSURANCE", isActive: true, name: { el: `Επίπεδο ${id}`, en: `Level ${id}` }, description: {}, sortOrder: 0,
  priceType: "per_day", priceCents: 800, maxTotalCents: null, maxQuantity: 1, vehicleTypes: [], excessCents: null, coverages: [], ...over,
});

function makeCtx() {
  return {
    settings: { timezone: "Europe/Athens", graceMinutes: 59, afterHours: { start: "23:00", end: "07:00", feeCents: 0 }, oneWayFeeCents: null, minLeadHours: 3, maxAdvanceDays: 365, vatPercent: 24 },
    seasons: [{ id: "all", name: { el: "Όλο τον χρόνο" }, startMonthDay: "01-01", endMonthDay: "12-31", minDays: null, priority: 0 }],
    locations: [loc("L1", "chania-airport", "Αεροδρόμιο Χανίων", "Chania Airport")],
    ageBands: [{ minAge: 21, maxAge: 99, label: {}, explanation: {}, allowed: true, isDefault: true, surchargeType: "none", surchargeCents: 0, surchargeMaxCents: null }],
    promotions: [],
    extras: [
      { id: "gps", kind: "EXTRA", isActive: true, name: { el: "GPS" }, description: {}, sortOrder: 0, priceType: "per_rental", priceCents: 450, maxTotalCents: null, maxQuantity: 1, vehicleTypes: [] },
      // Η (πρώην) «προεπιλεγμένη» βασική — ΔΕΝ πρέπει να μπαίνει μόνη της.
      level("basic", { isDefault: true, priceCents: 0, excessCents: 80000, sortOrder: 2 }),
      level("full", {
        name: { el: "Πλήρης", en: "Full" },
        description: { el: "Χωρίς συμμετοχή", en: "No excess" },
        coverages: [{ el: "Τροχοί & Ταμπλά", en: "Wheels & underbody" }, { el: "Τζάμια" }],
        priceCents: 1200, excessCents: 0, sortOrder: 0,
      }),
      level("weekly", { priceType: "per_rental", priceCents: 3000, sortOrder: 1 }),
      level("capped", { priceCents: 1000, maxTotalCents: 5000, sortOrder: 3 }),
      level("odd", { priceCents: 450, sortOrder: 4 }),
      level("motoOnly", { vehicleTypes: ["moto"], sortOrder: 5 }),
      level("off", { isActive: false, sortOrder: 6 }),
    ],
    groups: new Map([
      ["grpA", { target: { vehicleType: "car", rentalGroupId: "grpA", vehicleId: null, basePriceCents: 3000, depositCents: null, excessCents: 90000, minDriverAge: null }, rates: [{ seasonId: "all", tiers: tiers(3000, 2800, 2500) }] }],
      ["grpM", { target: { vehicleType: "moto", rentalGroupId: "grpM", vehicleId: null, basePriceCents: 2000, depositCents: null, excessCents: null, minDriverAge: null }, rates: [] }],
    ]),
    vehicles: new Map([
      ["veh1", { target: { vehicleType: "car", rentalGroupId: "grpA", vehicleId: "veh1", basePriceCents: 9999, depositCents: null, excessCents: null, minDriverAge: null }, rates: [] }],
      ["m1", { target: { vehicleType: "moto", rentalGroupId: "grpM", vehicleId: "m1", basePriceCents: 9999, depositCents: null, excessCents: null, minDriverAge: null }, rates: [] }],
    ]),
  };
}
const GROUPS = [{ id: "grpA", code: "A" }, { id: "grpM", code: "M" }];

const site = (ctx, insuranceId, over = {}) =>
  quoteFromContext(ctx, {
    ...requestFromCriteria(ctx, GROUPS, "g.A", { pl: "chania-airport", dl: null, from: "2026-11-02T10:00", to: "2026-11-05T10:00", age: 30, ...over }),
    insuranceId,
  });

/* ─────────────────────────────────────────────
   Καμία προεπιλογή
   ───────────────────────────────────────────── */

test("χωρίς insuranceId: καμία γραμμή ασφάλειας — ούτε η (πρώην) προεπιλεγμένη", () => {
  const ctx = makeCtx();
  for (const id of [undefined, null]) {
    const out = site(ctx, id);
    assert.equal(out.ok, true);
    assert.equal(out.result.lines.some((l) => l.kind === "insurance"), false);
    assert.equal(out.result.insurance, null);
    assert.equal(out.result.totalCents, 9000);
    assert.equal(out.result.excessCents, 90000, "η απαλλαγή της ομάδας, όχι της ασφάλειας");
  }
  // Dashboard: κράτηση χωρίς επιλεγμένη ασφάλεια → επίσης καμία.
  const dash = quoteFromContext(ctx, requestFromBooking(ctx, { vehicleId: "veh1", pickupDate: "2026-11-02", pickupTime: "10:00", returnDate: "2026-11-05", returnTime: "10:00", pickupLocation: "Αεροδρόμιο Χανίων", extraIds: ["gps"] }));
  assert.equal(dash.result.lines.some((l) => l.kind === "insurance"), false);
});

/* ─────────────────────────────────────────────
   Με επίπεδο: τιμή, ταβάνι, στρογγυλοποίηση, ΦΠΑ
   ───────────────────────────────────────────── */

test("ανά ημέρα: «Ασφάλεια · <όνομα>» × ημέρες, μέσα στο σύνολο και στον ΦΠΑ", () => {
  const q = site(makeCtx(), "full").result;
  const line = q.lines.find((l) => l.kind === "insurance");
  assert.deepEqual(line, { kind: "insurance", refId: "full", label: { el: "Ασφάλεια · Πλήρης", en: "Insurance · Full" }, qty: 3, unitCents: 1200, totalCents: 3600 });
  assert.equal(q.totalCents, 9000 + 3600);
  assert.equal(q.vatCents, 12600 - Math.round(12600 / 1.24));
  assert.equal(q.excessCents, 0, "η συμμετοχή του επιπέδου (μόνο ενημερωτική)");
});

test("ανά ενοικίαση, ταβάνι και στρογγυλοποίηση σε ακέραιο €", () => {
  const ctx = makeCtx();
  assert.equal(site(ctx, "weekly").result.lines.find((l) => l.kind === "insurance").totalCents, 3000);
  // 10 €/ημέρα × 7 ημέρες = 70 € → ταβάνι 50 €.
  const capped = site(ctx, "capped", { to: "2026-11-09T10:00" }).result;
  assert.equal(capped.lines.find((l) => l.kind === "insurance").totalCents, 5000);
  assert.equal(chargeTotalCents({ priceType: "per_day", priceCents: 1000, maxTotalCents: 5000 }, 7), 5000);
  // 4,50 €/ημέρα × 3 = 13,50 € → σύνολο ακέραιο € με γραμμή «Στρογγυλοποίηση».
  const odd = site(ctx, "odd").result;
  assert.equal(odd.totalCents % 100, 0);
  assert.equal(odd.totalCents, 9000 + 1400);
  assert.equal(odd.lines.find((l) => l.kind === "rounding").totalCents, 50);
});

/* ─────────────────────────────────────────────
   ΙΣΟΤΗΤΑ dashboard ↔ δημόσια φόρμα (golden)
   ───────────────────────────────────────────── */

const SCENARIOS = [
  { name: "3 ημέρες χωρίς ασφάλεια", from: "2026-11-02", to: "2026-11-05", ins: null, extras: [] },
  { name: "3 ημέρες με πλήρη", from: "2026-11-02", to: "2026-11-05", ins: "full", extras: [] },
  { name: "7 ημέρες με ταβάνι + GPS", from: "2026-11-02", to: "2026-11-09", ins: "capped", extras: ["gps"] },
  { name: "5 ημέρες ανά ενοικίαση", from: "2026-11-02", to: "2026-11-07", ins: "weekly", extras: [] },
  { name: "3 ημέρες με λεπτά (στρογγυλοποίηση)", from: "2026-11-02", to: "2026-11-05", ins: "odd", extras: ["gps"] },
  { name: "10 ημέρες χωρίς ασφάλεια + GPS", from: "2026-11-02", to: "2026-11-12", ins: null, extras: ["gps"] },
];

for (const sc of SCENARIOS) {
  test(`golden · ${sc.name}: dashboard = site`, () => {
    const ctx = makeCtx();
    const viaSite = quoteFromContext(ctx, {
      ...requestFromCriteria(ctx, GROUPS, "g.A", { pl: "chania-airport", dl: null, from: `${sc.from}T10:00`, to: `${sc.to}T10:00`, age: null }),
      extras: sc.extras.map((id) => ({ id, qty: 1 })),
      insuranceId: sc.ins,
    }).result;
    const viaDash = quoteFromContext(
      ctx,
      requestFromBooking(ctx, {
        vehicleId: "veh1", pickupDate: sc.from, pickupTime: "10:00", returnDate: sc.to, returnTime: "10:00",
        pickupLocation: "Αεροδρόμιο Χανίων", extraIds: [...sc.extras, ...(sc.ins ? [sc.ins] : [])],
      })
    ).result;
    assert.deepEqual(viaDash.lines, viaSite.lines);
    assert.equal(viaDash.totalCents, viaSite.totalCents);
    assert.equal(viaDash.vatCents, viaSite.vatCents);
    assert.deepEqual(viaDash.insurance, viaSite.insurance);
    assert.equal(viaSite.totalCents % 100, 0);
    // Ο «Δοκιμαστικός υπολογισμός» στέλνει ακριβώς target + insuranceId: ίδιο αποτέλεσμα.
    const viaTester = quoteFromContext(ctx, {
      target: { kind: "group", id: "grpA" }, pickupAt: `${sc.from}T10:00`, dropoffAt: `${sc.to}T10:00`, pickupLocationId: "L1",
      driverAge: null, extras: sc.extras.map((id) => ({ id, qty: 1 })), insuranceId: sc.ins,
    }).result;
    assert.equal(viaTester.totalCents, viaSite.totalCents);
  });
}

/* ─────────────────────────────────────────────
   Απορρίψεις
   ───────────────────────────────────────────── */

test("απόρριψη: επίπεδο άλλης εταιρίας, ανενεργό ή μη επιτρεπτό για τον τύπο οχήματος", () => {
  const ctx = makeCtx();
  // Το ctx είναι ΜΙΑΣ εταιρίας: id άλλης εταιρίας απλώς δεν υπάρχει.
  for (const id of ["otherTenantLevel", "off", "motoOnly", "gps"]) {
    const out = site(ctx, id);
    assert.equal(out.ok, false, id);
    assert.equal(out.reason, "insurance", id);
  }
  // Στη μηχανή η μηχανή ΔΕΝ «πέφτει» σιωπηλά σε «χωρίς ασφάλεια».
  assert.match(INSURANCE_INVALID_MESSAGE.el, /δεν είναι διαθέσιμη/);
  // Για μηχανή το motoOnly επιτρέπεται.
  const moto = quoteFromContext(ctx, { target: { kind: "group", id: "grpM" }, pickupAt: "2026-11-02T10:00", dropoffAt: "2026-11-05T10:00", insuranceId: "motoOnly" });
  assert.equal(moto.ok, true);
  // Dashboard: ίδια απόρριψη (π.χ. συμβόλαιο αυτοκινήτου με ασφάλεια μόνο για μηχανές).
  const dash = quoteFromContext(ctx, requestFromBooking(ctx, { vehicleId: "veh1", pickupDate: "2026-11-02", pickupTime: "10:00", returnDate: "2026-11-05", returnTime: "10:00", extraIds: ["motoOnly"] }));
  assert.equal(dash.ok, false);
  assert.equal(dash.reason, "insurance");
});

/* ─────────────────────────────────────────────
   Επιλογές του site
   ───────────────────────────────────────────── */

test("site: επίπεδα με τη σειρά τους, καλύψεις, «+X €/ημέρα» και σύνολο· ενότητα κρυφή χωρίς επίπεδα", () => {
  const ctx = makeCtx();
  const opts = insuranceOptions(ctx, "car", "en", 7);
  assert.deepEqual(opts.map((o) => o.id), ["full", "weekly", "basic", "capped", "odd"]);
  const full = opts[0];
  assert.deepEqual(full, {
    id: "full", name: "Full", description: "No excess", coverages: ["Wheels & underbody", "Τζάμια"],
    priceCents: 1200, priceType: "per_day", maxTotalCents: null, totalCents: 8400, excessCents: 0,
  });
  assert.equal(opts.find((o) => o.id === "capped").totalCents, 5000);
  // Κανένα επίπεδο για τον τύπο → κενή λίστα → η ενότητα δεν εμφανίζεται καθόλου.
  const noLevels = { ...ctx, extras: ctx.extras.filter((e) => e.kind !== "INSURANCE" || e.id === "motoOnly") };
  assert.deepEqual(insuranceOptions(noLevels, "car", "el", 3), []);
  assert.equal(insuranceOptions(noLevels, "moto", "el", 3).length, 1);
  // Τα πρόσθετα δεν άλλαξαν συμπεριφορά (και δεν περιέχουν ασφάλειες).
  assert.deepEqual(extraOptions(ctx, "car", "el").map((o) => o.id), ["gps"]);
  // ΜΟΝΟ δημόσια πεδία.
  assert.deepEqual(Object.keys(full).sort(), ["coverages", "description", "excessCents", "id", "maxTotalCents", "name", "priceCents", "priceType", "totalCents"]);
  assert.deepEqual(insuranceLevelsFor(ctx, "atv").map((e) => e.id), ["full", "weekly", "basic", "capped", "odd"]);
});

test("fallback γλώσσας: ζητούμενη → en → el → πρώτη", () => {
  assert.equal(textFor({ el: "Τζάμια" }, "en"), "Τζάμια");
  assert.equal(textFor({ en: "Glass", el: "Τζάμια" }, "fr"), "Glass");
  assert.equal(textFor({ de: "Glas" }, "el"), "Glas");
  assert.deepEqual(readLocalizedList([{ el: " Τζάμια " }, {}, "x", { en: "" }, { en: "Glass" }]), [{ el: "Τζάμια" }, { en: "Glass" }]);
  const el = insuranceOptions(makeCtx(), "car", "el", 3)[0];
  assert.equal(el.name, "Πλήρης");
  assert.deepEqual(el.coverages, ["Τροχοί & Ταμπλά", "Τζάμια"]);
});

/* ─────────────────────────────────────────────
   Snapshot στο priceQuote · παλιές κρατήσεις
   ───────────────────────────────────────────── */

test("snapshot: όνομα, τιμή και καλύψεις ΟΠΩΣ ΗΤΑΝ — αλλαγή του επιπέδου μετά δεν τα αλλάζει", () => {
  const ctx = makeCtx();
  const q = site(ctx, "full").result;
  const stored = JSON.parse(JSON.stringify(toStoredQuote(q, null, true, new Date("2026-10-16T10:00:00Z"))));
  assert.deepEqual(stored.quote.insurance, {
    id: "full", name: { el: "Πλήρης", en: "Full" }, priceType: "per_day", priceCents: 1200, maxTotalCents: null, excessCents: 0,
    coverages: [{ el: "Τροχοί & Ταμπλά", en: "Wheels & underbody" }, { el: "Τζάμια" }], totalCents: 3600,
  });
  // Ο διαχειριστής αλλάζει το επίπεδο αργότερα: η αποθηκευμένη ανάλυση μένει ίδια.
  ctx.extras.find((e) => e.id === "full").priceCents = 9900;
  ctx.extras.find((e) => e.id === "full").name = { el: "Άλλο" };
  assert.equal(storedInsurance(stored).name.el, "Πλήρης");
  assert.equal(storedInsurance(stored).totalCents, 3600);
  // Dashboard: στο snapshot πρόσθετων το σκέτο όνομα του επιπέδου.
  const b = toPriceBreakdown(q);
  assert.deepEqual(b.lines.map((l) => [l.type, l.name, l.lineTotal]), [["INSURANCE", "Πλήρης", 36]]);
  assert.equal(b.insuranceCost, 36);
});

test("παλιές κρατήσεις: χωρίς πεδίο insurance στο priceQuote → από τη γραμμή, ή τίποτα· τίποτα δεν ξαναϋπολογίζεται", () => {
  const legacy = { version: 1, totalCents: 9000, quote: { lines: [{ kind: "rental", label: { el: "Ενοίκιο" }, qty: 3, unitCents: 3000, totalCents: 9000 }] } };
  assert.equal(storedInsurance(legacy), null);
  const legacyWithLine = { version: 1, quote: { lines: [{ kind: "insurance", label: { el: "Βασική" }, qty: 3, unitCents: 0, totalCents: 0 }] } };
  assert.deepEqual(storedInsurance(legacyWithLine), { name: { el: "Βασική" }, coverages: [], totalCents: 0, excessCents: null });
  assert.equal(storedInsurance(null), null);
});

test("σελίδα επιβεβαίωσης + μήνυμα: το επιλεγμένο επίπεδο από το ΑΠΟΘΗΚΕΥΜΕΝΟ priceQuote", () => {
  const q = site(makeCtx(), "full").result;
  const priceQuote = toStoredQuote(q, null, true);
  const src = {
    publicCode: "T7NF-TV74", status: "PENDING", pickupDate: new Date("2026-11-02T00:00:00Z"), pickupTime: "10:00",
    returnDate: new Date("2026-11-05T00:00:00Z"), returnTime: "10:00", pickupLocation: null, returnLocation: null,
    priceQuote, total: 126, customer: { firstName: "Maria", email: "m@example.com" }, groupName: "A", groupSimilar: null, photoUrl: null,
  };
  const dto = toConfirmationDTO(src);
  assert.deepEqual(dto.insurance, { name: { el: "Πλήρης", en: "Full" }, coverages: [{ el: "Τροχοί & Ταμπλά", en: "Wheels & underbody" }, { el: "Τζάμια" }] });
  assert.equal(dto.totalCents, 12600);
  assert.equal(toConfirmationDTO({ ...src, priceQuote: toStoredQuote(site(makeCtx(), null).result, null, true) }).insurance, null);
  // Το DTO δεν έχει τίποτα από τη ρύθμιση του επιπέδου πέρα από όνομα/καλύψεις.
  assert.ok(!JSON.stringify(dto.insurance).includes("sortOrder"));

  const base = {
    kind: "confirm", lang: "el", code: "T7NF-TV74", firstName: "Maria", groupName: "A", groupSimilar: null, from: "2026-11-02T10:00",
    to: "2026-11-05T10:00", pickupLocation: null, returnLocation: null, totalCents: 12600, company: { name: "Co", phone: null, email: null },
    bookingUrl: null, searchUrl: null,
  };
  assert.ok(buildBookingMessage({ ...base, insuranceName: "Πλήρης" }).text.includes("Ασφάλεια: Πλήρης"));
  assert.ok(buildBookingMessage({ ...base, insuranceName: null }).text.includes("Ασφάλεια: Χωρίς πρόσθετη ασφάλεια"));
  assert.ok(!buildBookingMessage({ ...base }).text.includes("Ασφάλεια:"), "παλιά κράτηση: καμία γραμμή");
});

/* ─────────────────────────────────────────────
   Διαχείριση επιπέδων (dashboard)
   ───────────────────────────────────────────── */

test("σχήμα επιπέδου: όνομα ΕΛ υποχρεωτικό, καλύψεις καθαρές, ποσά σε cents", () => {
  const ok = insuranceLevelSchema.parse({
    nameI18n: { el: "Πλήρης", en: "Full" },
    coveragesI18n: [{ el: " Τζάμια ", en: "Glass" }, { el: "", en: "" }, {}],
    priceCents: 1200, chargeType: "PER_DAY", vehicleTypes: ["car", "car"],
  });
  assert.deepEqual(ok.coveragesI18n, [{ el: "Τζάμια", en: "Glass" }]);
  assert.deepEqual(ok.vehicleTypes, ["car"]);
  assert.equal(ok.isActive, true);
  assert.equal(ok.maxTotalCents, null);
  assert.equal(insuranceLevelSchema.safeParse({ nameI18n: { en: "Full" }, priceCents: 100, chargeType: "PER_DAY" }).success, false);
  assert.equal(insuranceLevelSchema.safeParse({ nameI18n: { el: "Χ" }, priceCents: -1, chargeType: "PER_DAY" }).success, false);
  assert.equal(insuranceLevelSchema.safeParse({ nameI18n: { el: "Χ" }, priceCents: 1.5, chargeType: "PER_DAY" }).success, false);
  assert.equal(
    insuranceLevelSchema.safeParse({ nameI18n: { el: "Χ" }, priceCents: 0, chargeType: "PER_DAY", coveragesI18n: Array.from({ length: 21 }, () => ({ el: "x" })) }).success,
    false
  );
});

test("διαγραφή: επίπεδο που χρησιμοποιήθηκε σε κράτηση γίνεται ανενεργό, αλλιώς σβήνεται", () => {
  assert.equal(deleteActionFor(0), "delete");
  assert.equal(deleteActionFor(1), "deactivate");
  assert.equal(deleteActionFor(42), "deactivate");
});

test("σειρά πάνω/κάτω", () => {
  const lv = [{ id: "a", sortOrder: 0 }, { id: "b", sortOrder: 1 }, { id: "c", sortOrder: 2 }];
  assert.deepEqual(moveLevel(lv, "c", "up"), [{ id: "c", sortOrder: 1 }, { id: "b", sortOrder: 2 }]);
  assert.deepEqual(moveLevel(lv, "a", "up"), []);
  assert.deepEqual(moveLevel(lv, "c", "down"), []);
  // Ίδια σειρά σε όλα (παλιά δεδομένα): κανονικοποίηση 0,1,2.
  const same = [{ id: "a", sortOrder: 0 }, { id: "b", sortOrder: 0 }, { id: "c", sortOrder: 0 }];
  assert.deepEqual(moveLevel(same, "a", "down"), [{ id: "a", sortOrder: 1 }, { id: "c", sortOrder: 2 }]);
});

test("μόνο Διαχειριστής διαχειρίζεται (ίδιος φύλακας με «Η σελίδα μου»)", async () => {
  const { storefrontAccess } = await import("../src/lib/storefront/admin.ts");
  for (const role of ["STAFF", "PARTNER", "SUPER_ADMIN"]) {
    const r = await storefrontAccess({ userId: "u", role, tenantId: role === "SUPER_ADMIN" ? null : "t1", permissions: { "settings.edit": true } });
    assert.equal(r.ok, false, role);
  }
  assert.equal((await storefrontAccess(undefined)).ok, false);
});
