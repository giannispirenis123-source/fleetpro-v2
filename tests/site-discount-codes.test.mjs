// tests/site-discount-codes.test.mjs — Εκπτωτικός κωδικός στο δημόσιο site
// (φάση 2): κωδικός συνεργάτη → μειωμένη προμήθεια, κωδικός εταιρίας → καμία
// αλλαγή προμήθειας, ίδιο ποσό παντού, ατομική χρήση, όρια, απόρρητο.

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

const SC = await import("../src/lib/public/siteCode.ts");
const C = await import("../src/lib/commission.ts");
const F = await import("../src/lib/partnerFinance.ts");
const { planSiteBooking, runSiteBooking } = await import("../src/lib/public/bookingPlan.ts");
const { quoteFromContext, requestFromCriteria } = await import("../src/lib/public/engine.ts");
const { toPublicQuote } = await import("../src/lib/public/bookingView.ts");
const { toConfirmationDTO, publicBookingSchema } = await import("../src/lib/public/bookingRequest.ts");
const { storedTotalCents } = await import("../src/lib/public/money.ts");
const { onlineAmountCents } = await import("../src/lib/public/payments.ts");
const { toPriceBreakdown, storedManualDiscount } = await import("../src/lib/pricingBridge.ts");
const { verifyOutgoingAmounts } = await import("../src/lib/public/outgoingAmounts.ts");
const { formatMoney } = await import("../src/lib/public/money.ts");
const { hitLimit, LIMITS } = await import("../src/lib/public/rateLimit.ts");
const { generateInvoiceCode } = await import("../src/lib/invoiceCode.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* ── Κατάλογος: 100 €/ημέρα, 3 ημέρες = 300 € ενοίκιο ── */

const NOW = new Date("2026-10-15T06:00:00.000Z");

function makeCat({ promotions = [], dailyCents = 10000 } = {}) {
  const groupTarget = { vehicleType: "car", rentalGroupId: "grpA", vehicleId: null, basePriceCents: dailyCents, depositCents: null, excessCents: null, minDriverAge: null };
  const ctx = {
    settings: { timezone: "Europe/Athens", graceMinutes: 59, afterHours: { start: "23:00", end: "07:00", feeCents: 0 }, oneWayFeeCents: null, minLeadHours: 3, maxAdvanceDays: 365, vatPercent: 24 },
    seasons: [],
    locations: [{ id: "L1", slug: "chania", name: { el: "Χανιά" }, adjustmentType: "none", adjustmentValue: 0, adjustmentLabel: {}, afterHoursFeeCents: null, allowPickup: true, allowDropoff: true, isActive: true, needsFlight: false }],
    ageBands: [{ minAge: 21, maxAge: 80, label: {}, explanation: {}, allowed: true, isDefault: true, surchargeType: "none", surchargeCents: 0, surchargeMaxCents: null }],
    promotions,
    extras: [{ id: "gps", kind: "EXTRA", isActive: true, isDefault: false, name: { el: "GPS" }, priceType: "per_rental", priceCents: 2000, maxTotalCents: null, maxQuantity: 1, vehicleTypes: [] }],
    groups: new Map([["grpA", { target: groupTarget, rates: [] }]]),
    vehicles: new Map([["v1", { target: { ...groupTarget, vehicleId: "v1" }, rates: [] }]]),
  };
  return {
    companyId: "T1",
    ctx,
    groups: [{ id: "grpA", code: "A", vehicleType: "car", name: { el: "Μικρό" }, similarModels: {}, seats: 4, doors: 5, transmission: "manual", fuel: "PETROL", bagsLarge: 1, bagsSmall: 1, airCondition: true, engineCc: null, photoUrl: null, sortOrder: 0 }],
    vehicles: [{ id: "v1", tenantId: "T1", rentalGroupId: "grpA", brand: "Fiat", model: "Panda", vehicleType: "car", seats: 4, doors: 5, transmission: "Manual", fuel: "PETROL", ac: true, photoUrl: null, status: "AVAILABLE", isActive: true }],
    rules: {
      timezone: "Europe/Athens", graceMinutes: 59, minLeadHours: 3, maxAdvanceDays: 365, defaultPickupTime: "10:00", defaultDropoffTime: "10:00", defaultRentalDays: 3,
      seasons: [], ageBands: [{ minAge: 21, maxAge: 80, allowed: true, isDefault: true, surchargeType: "none" }],
      locations: [{ slug: "chania", allowPickup: true, allowDropoff: true }],
    },
    prepTimeMinutes: 0,
  };
}

const CRIT = { pl: "chania", dl: "chania", from: "2026-11-02T10:00", to: "2026-11-05T10:00", age: 30 };
const quoteOf = (cat, extras = []) => quoteFromContext(cat.ctx, { ...requestFromCriteria(cat.ctx, cat.groups, "g.A", CRIT, NOW), extras }).result;

const partner = (over = {}) => ({
  id: "P1", role: "PARTNER", tenantId: "T1", isActive: true, commissionRate: 20,
  commissionOnRental: true, commissionOnExtras: false, commissionOnInsurance: false, ...over,
});
const rec = (over = {}) => ({
  id: "D1", tenantId: "T1", code: "PART5", type: "PERCENTAGE", value: 5, target: "ALL",
  minDays: null, minAmount: null, maxDiscount: null, validFrom: null, validUntil: null,
  usageLimit: null, usageCount: 0, isActive: true, partnerId: "P1", partner: partner(), ...over,
});
const SETTINGS20 = { rate: 20, onRental: true, onExtras: false, onInsurance: false };
const partsOf = (q) => {
  const b = toPriceBreakdown(q);
  return { subtotal: b.subtotal, extrasTotal: b.extrasTotal, insuranceCost: b.insuranceCost };
};

/* ─────────────────────────────────────────────
   Προμήθεια: 20% − 5% → 15%, ίσο → 0, πάνω → απόρριψη
   ───────────────────────────────────────────── */

test("κωδικός συνεργάτη 5% με προμήθεια 20% → έκπτωση 15 €, προμήθεια 15% (45 €), η εταιρία παίρνει ΑΚΡΙΒΩΣ τα ίδια", () => {
  const q = quoteOf(makeCat());
  assert.equal(q.totalCents, 30000);
  const r = SC.evaluateSiteCode(rec(), q, { tenantId: "T1", now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.applied.cents, 1500);
  assert.deepEqual(r.applied.partner, { userId: "P1", percent: 5, onRental: true, onExtras: false, onInsurance: false, maxDiscount: null });
  const parts = partsOf(q);
  const full = C.commissionFor(parts, SETTINGS20);
  const reduced = C.bookingCommission(parts, SETTINGS20, { cents: r.applied.cents });
  assert.equal(full, 60);
  assert.equal(reduced, 45);
  assert.equal(C.reducedRate(SETTINGS20, { percent: 5 }), 15);
  assert.equal(Math.round(reduced * 100), Math.round(C.commissionBase(parts, SETTINGS20) * 15)); // 15% × 300
  // Η εταιρία: (σύνολο − έκπτωση) − μειωμένη προμήθεια = σύνολο − κανονική προμήθεια.
  assert.equal(q.totalCents - r.applied.cents - reduced * 100, q.totalCents - full * 100);
});

test("κωδικός ΙΣΟΣ με την προμήθεια (20%) → προμήθεια 0 €· ποτέ αρνητική", () => {
  const q = quoteOf(makeCat());
  const r = SC.evaluateSiteCode(rec({ value: 20 }), q, { tenantId: "T1", now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.applied.cents, 6000);
  assert.equal(C.bookingCommission(partsOf(q), SETTINGS20, { cents: 6000 }), 0);
  assert.equal(C.reducedRate(SETTINGS20, { percent: 20 }), 0);
  // Αν ο Διαχειριστής μειώσει ΜΕΤΑ το ποσοστό: μηδέν, όχι αρνητικό.
  assert.equal(C.bookingCommission(partsOf(q), { ...SETTINGS20, rate: 10 }, { cents: 6000 }), 0);
});

test("κωδικός πάνω από την ΤΡΕΧΟΥΣΑ προμήθεια (ο Διαχειριστής τη μείωσε) → απόρριψη με σαφές μήνυμα, όχι σιωπηλό κόψιμο", () => {
  const q = quoteOf(makeCat());
  const r = SC.evaluateSiteCode(rec({ value: 5, partner: partner({ commissionRate: 4 }) }), q, { tenantId: "T1", now: NOW });
  assert.deepEqual(r, { ok: false, reason: "unavailable" });
  assert.match(SC.SITE_CODE_MESSAGES.unavailable.el, /δεν είναι πλέον διαθέσιμος/);
  // Συνεργάτης χωρίς προμήθεια: κανένας κωδικός.
  assert.equal(SC.evaluateSiteCode(rec({ partner: partner({ commissionRate: 0 }) }), q, { tenantId: "T1", now: NOW }).ok, false);
  // Ίσο με το νέο ποσοστό: επιτρέπεται.
  assert.equal(SC.evaluateSiteCode(rec({ value: 4, partner: partner({ commissionRate: 4 }) }), q, { tenantId: "T1", now: NOW }).ok, true);
});

test("κωδικός συνεργάτη σε ευρώ, ανενεργού συνεργάτη, άλλης εταιρίας → απόρριψη (ίδια απάντηση για «δεν υπάρχει» και «άλλης εταιρίας»)", () => {
  const q = quoteOf(makeCat());
  const ev = (r) => SC.evaluateSiteCode(r, q, { tenantId: "T1", now: NOW });
  assert.deepEqual(ev(rec({ type: "FIXED_AMOUNT", value: 10 })), { ok: false, reason: "unavailable" });
  assert.deepEqual(ev(rec({ partner: partner({ isActive: false }) })), { ok: false, reason: "unavailable" });
  // Ανατεθειμένος σε χρήστη άλλης εταιρίας / όχι πια συνεργάτη / χωρίς στοιχεία → απόρριψη (ΠΟΤΕ κωδικός εταιρίας).
  assert.deepEqual(ev(rec({ partner: partner({ tenantId: "T2" }) })), { ok: false, reason: "unavailable" });
  assert.deepEqual(ev(rec({ partner: partner({ role: "STAFF" }) })), { ok: false, reason: "unavailable" });
  assert.deepEqual(ev(rec({ partner: null })), { ok: false, reason: "unavailable" });
  assert.deepEqual(ev(rec({ tenantId: "T2" })), { ok: false, reason: "invalid" });
  assert.deepEqual(ev(null), { ok: false, reason: "invalid" });
  assert.deepEqual(ev(rec({ tenantId: "T2" })), ev(null));
});

test("κωδικός της ΕΤΑΙΡΙΑΣ (χωρίς partnerId): όπως στο dashboard, καμία αλλαγή στην προμήθεια", () => {
  const q = quoteOf(makeCat(), [{ id: "gps", qty: 1 }]); // 300 + 20 = 320 €
  assert.equal(q.totalCents, 32000);
  // Χωρίς partnerId = κωδικός εταιρίας, ΟΠΟΙΟΣ κι αν τον δημιούργησε (και συνεργάτης παλιά).
  for (const createdBy of [null, "S1", "A1", "P1"]) {
    const r = SC.evaluateSiteCode(rec({ code: "SUMMER", value: 10, partnerId: null, partner: null, createdById: createdBy }), q, { tenantId: "T1", now: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.applied.partner, null);
    // 10% πάνω στο σύνολο (όπως ο κωδικός του dashboard), ακέραιο €.
    assert.equal(r.applied.cents, 3200);
  }
  // Σταθερό ποσό: επιτρέπεται για κωδικό εταιρίας.
  assert.equal(SC.evaluateSiteCode(rec({ type: "FIXED_AMOUNT", value: 25, partnerId: null, partner: null }), q, { tenantId: "T1", now: NOW }).applied.cents, 2500);
  // Κράτηση χωρίς κωδικό συνεργάτη: πλήρης προμήθεια (καμία αλλαγή).
  assert.equal(C.bookingCommission(partsOf(q), SETTINGS20, null), C.commissionFor(partsOf(q), SETTINGS20));
});

test("βάση: ο κωδικός συνεργάτη στην ΙΔΙΑ βάση με την προμήθεια (π.χ. χωρίς τα πρόσθετα)", () => {
  const q = quoteOf(makeCat(), [{ id: "gps", qty: 1 }]); // ενοίκιο 300 + GPS 20
  const r = SC.evaluateSiteCode(rec(), q, { tenantId: "T1", now: NOW });
  assert.equal(r.applied.cents, 1500, "5% του ενοικίου (300), ΟΧΙ του 320");
  // Συνεργάτης με προμήθεια ΚΑΙ στα πρόσθετα: η έκπτωση και η προμήθεια στη ίδια βάση (320).
  const r2 = SC.evaluateSiteCode(rec({ partner: partner({ commissionOnExtras: true }) }), q, { tenantId: "T1", now: NOW });
  assert.equal(r2.applied.cents, 1600);
});

test("στρογγυλοποίηση: η έκπτωση προς τα ΚΑΤΩ σε ακέραιο €· η εταιρία ΠΟΤΕ δεν χάνει (για κάθε ποσό/ποσοστό)", () => {
  for (const daily of [3333, 4567, 9999, 12345]) {
    const q = quoteOf(makeCat({ dailyCents: daily }));
    for (const pct of [1, 2.5, 5, 7, 13.33, 20]) {
      const r = SC.evaluateSiteCode(rec({ value: pct }), q, { tenantId: "T1", now: NOW });
      if (!r.ok) {
        assert.equal(r.reason, "not_applicable");
        continue;
      }
      assert.equal(r.applied.cents % 100, 0, "ακέραιο €");
      const parts = partsOf(q);
      const base = Math.round(C.commissionBase(parts, SETTINGS20) * 100);
      assert.ok(r.applied.cents <= (base * pct) / 100 + 1e-6, "ποτέ πάνω από ποσοστό × βάση");
      const full = Math.round(C.commissionFor(parts, SETTINGS20) * 100);
      const reduced = Math.round(C.bookingCommission(parts, SETTINGS20, r.applied) * 100);
      assert.ok(reduced >= Math.floor((base * (20 - pct)) / 100) - 1, "προμήθεια ≥ (ποσοστό − κωδικός) × βάση");
      assert.equal(q.totalCents - r.applied.cents - reduced, q.totalCents - full, `εταιρία ίδια (${daily}, ${pct})`);
    }
  }
});

test("ισχύς: λήξη, όχι ακόμα, εξαντλημένος, ελάχιστες ημέρες/ποσό, δεμένος σε πελάτη → σωστός λόγος", () => {
  const q = quoteOf(makeCat());
  const ev = (o) => SC.evaluateSiteCode(rec(o), q, { tenantId: "T1", now: NOW }).reason;
  assert.equal(ev({ validUntil: new Date("2026-10-01T00:00:00Z") }), "expired");
  assert.equal(ev({ validFrom: new Date("2026-12-01T00:00:00Z") }), "not_yet");
  assert.equal(ev({ usageLimit: 3, usageCount: 3 }), "exhausted");
  assert.equal(ev({ minDays: 5 }), "not_applicable");
  assert.equal(ev({ minAmount: 500 }), "not_applicable");
  assert.equal(ev({ target: "CUSTOMER" }), "not_applicable");
  assert.equal(ev({ isActive: false }), "unavailable");
  assert.equal(SC.normalizeSiteCode("  part5 "), "PART5");
  assert.equal(SC.normalizeSiteCode("a"), null);
  assert.equal(SC.normalizeSiteCode("Β; DROP"), null);
});

/* ─────────────────────────────────────────────
   Ίδιο ποσό παντού: φόρμα, κράτηση, σελίδα/PDF, email, Stripe
   ───────────────────────────────────────────── */

const REQ = { key: "g.A", criteria: CRIT, extras: [], insuranceId: undefined, driverAge: 30 };

test("κράτηση με κωδικό: ίδιο σύνολο σε φόρμα, priceQuote, σελίδα κράτησης/PDF, email και Stripe Checkout", () => {
  const cat = makeCat();
  const record = rec();
  const r = planSiteBooking(cat, { ...REQ, discountCode: "part5" }, [], NOW, record);
  assert.equal(r.ok, true);
  const { plan } = r;
  assert.equal(plan.code.cents, 1500);
  // priceQuote: σύνολο 285 €, έκπτωση στο manualDiscount μαζί με τον συνεργάτη.
  assert.equal(plan.stored.totalCents, 28500);
  assert.equal(plan.breakdown.total, 285);
  assert.equal(plan.stored.manualDiscount.cents, 1500);
  assert.equal(plan.stored.manualDiscount.code, "PART5");
  assert.equal(plan.stored.manualDiscount.partner.userId, "P1");
  assert.equal(C.partnerCodeOf(plan.stored).cents, 1500);
  // Φόρμα (/api/public/discount-code): ίδιο σύνολο.
  const pub = toPublicQuote(plan.quote, plan.code, cat.ctx.settings.vatPercent);
  assert.equal(pub.totalCents, plan.stored.totalCents);
  assert.equal(pub.lines.reduce((s, l) => s + l.totalCents, 0), pub.totalCents);
  assert.equal(pub.vatCents, plan.stored.quote.vatCents);
  assert.equal(pub.vatCents, 28500 - Math.round(28500 / 1.24));
  // Σελίδα κράτησης (και το PDF της, που είναι η ίδια σελίδα): γραμμές = σύνολο.
  const dto = toConfirmationDTO({
    publicCode: "ABCD-EFGH", status: "PENDING", customer: { firstName: "Μ", email: "m@example.com" },
    groupName: "Μικρό", groupSimilar: null, photoUrl: null,
    pickupDate: new Date("2026-11-02T00:00:00Z"), pickupTime: "10:00", returnDate: new Date("2026-11-05T00:00:00Z"), returnTime: "10:00",
    pickupLocation: "Χανιά", returnLocation: "Χανιά", priceQuote: plan.stored, total: plan.breakdown.total,
  });
  assert.equal(dto.totalCents, 28500);
  assert.equal(dto.lines.reduce((s, l) => s + l.totalCents, 0), 28500);
  assert.ok(dto.lines.some((l) => l.kind === "code" && l.totalCents === -1500 && /PART5/.test(l.label.el)));
  // Email / Stripe: από το ΑΠΟΘΗΚΕΥΜΕΝΟ σύνολο.
  const total = storedTotalCents(plan.stored, plan.breakdown.total);
  assert.equal(total, 28500);
  assert.equal(onlineAmountCents(total, "FULL", 30), 28500);
  const line = `Σύνολο: ${formatMoney(total, "el", { plainSpace: true })}`;
  const email = `Η κράτησή σας ABCD-EFGH.\n${line}\nΦΠΑ: ${formatMoney(dto.vatCents, "el", { plainSpace: true })}`;
  assert.deepEqual(verifyOutgoingAmounts(email, { totalCents: total, otherCents: [dto.vatCents], totalLine: line }), { ok: true });
});

test("ο πελάτης δεν βλέπει ΠΟΤΕ συνεργάτη ή προμήθεια (φόρμα, σελίδα κράτησης, route)", () => {
  const cat = makeCat();
  const { plan } = planSiteBooking(cat, { ...REQ, discountCode: "PART5" }, [], NOW, rec());
  const pub = JSON.stringify(toPublicQuote(plan.quote, plan.code, 24));
  const dto = JSON.stringify(
    toConfirmationDTO({
      publicCode: "ABCD-EFGH", status: "PENDING", customer: { firstName: "Μ", email: "m@example.com" }, groupName: "Μ", groupSimilar: null, photoUrl: null,
      pickupDate: new Date("2026-11-02T00:00:00Z"), pickupTime: "10:00", returnDate: new Date("2026-11-05T00:00:00Z"), returnTime: "10:00",
      pickupLocation: null, returnLocation: null, priceQuote: plan.stored, total: 285,
    })
  );
  for (const s of [pub, dto]) assert.doesNotMatch(s, /P1|partner|commission|userId|percent|προμήθ|συνεργ/i);
  const route = read("src/app/api/public/discount-code/route.ts");
  assert.match(route, /data: \{\s*code: q\.code!\.code,\s*quote: toPublicQuote\(q\.quote, q\.code, cat\.ctx\.settings\.vatPercent\),\s*\}/);
  // toPublicQuote παίρνει ΜΟΝΟ κωδικό και ποσό.
  assert.match(read("src/lib/public/bookingView.ts"), /code\?: \{ code: string; cents: number \} \| null/);
});

test("τιμή/έκπτωση/προμήθεια από τον browser αγνοούνται (μόνο ο κωδικός ως κείμενο)", () => {
  const body = {
    slug: "fleet", lang: "el", key: "g.A", criteria: CRIT, extras: [], firstName: "Α", lastName: "Β", email: "a@b.gr",
    phoneCountry: "+30", phone: "6900000000", birthDate: "1990-01-01", acceptTerms: true, discountCode: "PART5",
    total: 1, totalCents: 100, discountAmount: 999, discountCents: 99900, commissionRate: 0, partnerId: "P2", partnerCode: { cents: 1 },
  };
  const parsed = publicBookingSchema.parse(body);
  for (const k of ["total", "totalCents", "discountAmount", "discountCents", "commissionRate", "partnerId", "partnerCode"]) assert.equal(k in parsed, false, k);
  assert.equal(parsed.discountCode, "PART5");
  const r = planSiteBooking(makeCat(), { ...REQ, discountCode: parsed.discountCode }, [], NOW, rec());
  assert.equal(r.plan.stored.totalCents, 28500);
  assert.equal(r.plan.code.partner.userId, "P1", "ο συνεργάτης ΜΟΝΟ από τον δημιουργό του κωδικού");
});

test("κωδικός που δεν ισχύει στην υποβολή → η κράτηση ΔΕΝ γράφεται (409, codeRejected)", () => {
  const cat = makeCat();
  const r = planSiteBooking(cat, { ...REQ, discountCode: "PART5" }, [], NOW, rec({ usageLimit: 1, usageCount: 1 }));
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CODE");
  assert.deepEqual(r.error.message, SC.SITE_CODE_MESSAGES.exhausted);
  const r2 = planSiteBooking(cat, { ...REQ, discountCode: "OTHER" }, [], NOW, null);
  assert.deepEqual(r2.error.message, SC.SITE_CODE_MESSAGES.invalid);
  const submit = read("src/lib/public/bookingSubmit.ts");
  assert.match(submit, /result\.error\.code === "CODE" \? 409/);
  assert.match(submit, /codeRejected: true/);
});

/* ─────────────────────────────────────────────
   Ταυτόχρονες κρατήσεις με κωδικό μίας χρήσης
   ───────────────────────────────────────────── */

function codeStore({ limit }) {
  const discount = { ...rec({ usageLimit: limit }), usageCount: 0 };
  const written = [];
  const tick = () => new Promise((r) => setTimeout(r, 3));
  return {
    discount,
    written,
    // Χωρίς κοινό κλείδωμα: η ατομικότητα πρέπει να έρχεται από το UPDATE με συνθήκη.
    withLock: (_k, fn) => fn({}),
    loadBookings: async () => [],
    loadCode: async () => {
      await tick();
      return { ...discount };
    },
    claimCode: async () => {
      await tick();
      // Όπως το UPDATE … WHERE "usageCount" < "usageLimit" (μία ατομική πράξη).
      if (discount.usageLimit !== null && discount.usageCount >= discount.usageLimit) return false;
      discount.usageCount += 1;
      return true;
    },
    write: async (_tx, plan) => {
      written.push(plan);
      return generateInvoiceCode();
    },
  };
}

test("δύο ταυτόχρονες κρατήσεις με κωδικό ΜΙΑΣ χρήσης → μία επιτυχία, μία απόρριψη", async () => {
  const store = codeStore({ limit: 1 });
  const req = { ...REQ, discountCode: "PART5" };
  const results = await Promise.all([runSiteBooking(store, makeCat(), req, NOW), runSiteBooking(store, makeCat(), req, NOW)]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  const failed = results.find((r) => !r.ok);
  assert.equal(failed.error.code, "CODE");
  assert.deepEqual(failed.error.message, SC.SITE_CODE_MESSAGES.exhausted);
  assert.equal(store.discount.usageCount, 1);
  assert.equal(store.written.length, 1);
  // Η δέσμευση στη βάση: ΕΝΑ UPDATE με τη συνθήκη μέσα, στην ίδια transaction με την εγγραφή.
  const sql = read("src/lib/public/siteCodeServer.ts");
  assert.match(sql, /AND \("usageLimit" IS NULL OR "usageCount" < "usageLimit"\)/);
  assert.match(sql, /return n === 1;/);
  const plan = read("src/lib/public/bookingPlan.ts");
  assert.ok(plan.indexOf("store.claimCode") < plan.indexOf("store.write(tx, planned.plan)"));
});

test("χωρίς όριο χρήσεων: και οι δύο περνούν· κράτηση χωρίς κωδικό δεν αγγίζει μετρητή", async () => {
  const store = codeStore({ limit: null });
  const results = await Promise.all([runSiteBooking(store, makeCat(), { ...REQ, discountCode: "PART5" }, NOW), runSiteBooking(store, makeCat(), REQ, NOW)]);
  assert.ok(results.every((r) => r.ok));
  assert.equal(store.discount.usageCount, 1);
  assert.equal(store.written.filter((p) => p.code).length, 1);
});

test("ακύρωση χωρίς πληρωμή (λήξη/αποτυχία/webhook) επιστρέφει τη χρήση — όπως η ακύρωση από το dashboard", () => {
  const pay = read("src/lib/public/paymentServer.ts");
  assert.match(pay, /await releaseDiscountUsageFor\(client, tenantId, ids\);/);
  assert.match(pay, /if \(r\.count === 1\) await releaseDiscountUsageFor\(db, tenantId, \[bookingId\]\);/);
  assert.match(pay, /t\.booking\.status === "CANCELLED" && b\.status !== "CANCELLED"\) await releaseDiscountUsageFor/);
  assert.match(read("src/lib/discounts.ts"), /status: "CANCELLED", discountCode: \{ not: null \}/);
});

/* ─────────────────────────────────────────────
   Όρια, απόρρητο, διαγραμμένος συνεργάτης
   ───────────────────────────────────────────── */

test("όριο ανά IP στον έλεγχο κωδικού → μετά το όριο «όχι» (429)", async () => {
  const counts = new Map();
  const store = { increment: async (k, w) => { const key = `${k}|${w.toISOString()}`; counts.set(key, (counts.get(key) ?? 0) + 1); return counts.get(key); } };
  const L = LIMITS.discountCodePerClient;
  assert.ok(L.max <= 20 && L.windowMinutes >= 10, "αυστηρό");
  for (let i = 0; i < L.max; i++) assert.equal(await hitLimit(store, L, "1.2.3.4", NOW), true);
  assert.equal(await hitLimit(store, L, "1.2.3.4", NOW), false);
  assert.equal(await hitLimit(store, L, "5.6.7.8", NOW), true, "άλλη IP");
  const route = read("src/app/api/public/discount-code/route.ts");
  assert.match(route, /hitLimit\(dbCounterStore, LIMITS\.discountCodePerClient, ip\)\)\) return reply\(\{ success: false, message: TOO_MANY \}, 429\)/);
  assert.match(route, /LIMITS\.discountCodePerTenant, resolved\.companyId/);
  // Σταθερός χρόνος και ΜΟΝΟ κωδικοί της εταιρίας του site.
  assert.match(route, /const MIN_RESPONSE_MS = \d{3};/);
  assert.match(route, /loadSiteCode\(db, resolved\.companyId, wanted\)/);
  assert.match(read("src/lib/public/siteCodeServer.ts"), /where: \{ tenantId, code \}/);
});

test("ο κανόνας «ανήκει σε συνεργάτη» διαβάζεται από το partnerId (όχι από τον δημιουργό)", () => {
  const server = read("src/lib/public/siteCodeServer.ts");
  assert.match(server, /partnerId: true,/);
  assert.match(server, /partner: \{\s*select:/);
  assert.doesNotMatch(server, /createdBy/);
  assert.doesNotMatch(read("src/lib/public/siteCode.ts"), /creator|createdById/);
});

/* ─────────────────────────────────────────────
   Προσφορές του site: ΑΜΕΤΑΒΛΗΤΕΣ
   ───────────────────────────────────────────── */

test("προσφορές του site: ίδια επιλογή/ποσό με και χωρίς κωδικό· ο κωδικός μπαίνει ΠΑΝΩ στο σύνολο", () => {
  const promo = {
    id: "PR1", name: { el: "Φθινόπωρο" }, badge: { el: "−10%" }, isActive: true, discountType: "percent", discountValue: 10,
    validFrom: "2026-10-01", validTo: "2026-12-31", locationIds: [], locationMatch: "either", rentalGroupIds: [], vehicleIds: [], vehicleTypes: [], minDays: null, sortOrder: 0,
  };
  const cat = makeCat({ promotions: [promo] });
  const without = planSiteBooking(cat, REQ, [], NOW).plan;
  const withCode = planSiteBooking(cat, { ...REQ, discountCode: "PART5" }, [], NOW, rec()).plan;
  const promoLines = (p) => p.quote.lines.filter((l) => l.kind === "discount");
  assert.deepEqual(promoLines(withCode), promoLines(without), "ίδια προσφορά");
  assert.equal(without.quote.totalCents, 27000); // 300 − 10%
  assert.equal(withCode.quote.totalCents, 27000, "η quote() δεν αλλάζει");
  // Κωδικός συνεργάτη: στη βάση της προμήθειας (ενοίκιο ΠΡΙΝ από έκπτωση = 300) → 15 €.
  assert.equal(withCode.stored.totalCents, 27000 - 1500);
  // Η εταιρία: ίδια με την κράτηση με προσφορά χωρίς κωδικό.
  const parts = { subtotal: withCode.breakdown.subtotal, extrasTotal: withCode.breakdown.extrasTotal, insuranceCost: withCode.breakdown.insuranceCost };
  const company = (p, code) => p.stored.totalCents - Math.round(C.bookingCommission(parts, SETTINGS20, code) * 100);
  assert.equal(company(withCode, withCode.code), company(without, null));
  // Ο κώδικας των προσφορών δεν άλλαξε (η μεγαλύτερη σε €, μόνο στο ενοίκιο).
  assert.match(read("src/lib/public/pricing.ts"), /amountCents: roundToEuro\(\(rentalCents \* pct\) \/ 100\)/);
});

/* ─────────────────────────────────────────────
   Οικονομικά / Προμήθειες συνεργατών / κάρτα κράτησης
   ───────────────────────────────────────────── */

test("Οικονομικά συνεργάτη: μειωμένη προμήθεια με ένδειξη κωδικού, ακυρωμένη 0, σύνολα ίδια με τις γραμμές", () => {
  const row = (over) => ({
    id: "b", bookingNumber: "BP-1", pickupDate: "2026-11-02", returnDate: "2026-11-05", customer: "Μ Π",
    status: "PENDING", paymentStatus: "NONE", totalCents: 28500, subtotal: 300, extrasTotal: 0, insuranceCost: 0, ...over,
  });
  const out = F.partnerFinance(
    [row({ id: "a", partnerCode: { code: "PART5", percent: 5, cents: 1500 } }), row({ id: "b", totalCents: 30000 }), row({ id: "c", status: "CANCELLED", partnerCode: { code: "PART5", percent: 5, cents: 1500 } })],
    SETTINGS20
  );
  assert.equal(out.items[0].commissionCents, 4500);
  assert.deepEqual(out.items[0].code, { code: "PART5", ratePct: 15 });
  assert.equal(out.items[1].commissionCents, 6000);
  assert.equal(out.items[1].code, null);
  assert.equal(out.items[2].commissionCents, 0);
  assert.equal(out.totals.commissionCents, 10500);
  // Σύνοψη κρατήσεων (κάρτες στο «Κρατήσεις»): ίδιος κανόνας.
  const sum = C.summarize([{ status: "PENDING", subtotal: 300, extrasTotal: 0, insuranceCost: 0, partnerCode: { cents: 1500 } }, { status: "CANCELLED", subtotal: 300, extrasTotal: 0, insuranceCost: 0, partnerCode: { cents: 1500 } }], SETTINGS20);
  assert.equal(sum.commission, 45);
  // Admin «Προμήθειες συνεργατών» και PDF: ΙΔΙΟ partnerFinance (FINANCE_SELECT έχει priceQuote).
  const server = read("src/lib/partnerServer.ts");
  assert.match(server, /priceQuote: true,/);
  assert.match(server, /partnerCode: codeOfRow\(r\),/);
  assert.match(read("src/lib/partnerCommissionsPdf.ts"), /b\.code \? `\$\{money\(b\.commissionCents\)\} \(\$\{pct\(b\.code\.ratePct\)\}\*\)`/);
  // Κάρτα κράτησης: κωδικός και μειωμένη προμήθεια.
  assert.match(read("src/lib/bookings.ts"), /bookingCommission\(/);
  assert.match(read("src/app/(dashboard)/dashboard/bookings/BookingsClient.tsx"), /b\.partnerCode\.ratePct/);
});

test("dashboard: ξαναϋπολογισμός κράτησης με κωδικό συνεργάτη κρατά ΙΔΙΟ κανόνα· αλλαγή συνεργάτη μπλοκάρεται", () => {
  const cat = makeCat();
  const { plan } = planSiteBooking(cat, { ...REQ, discountCode: "PART5" }, [], NOW, rec());
  const m = storedManualDiscount(plan.stored);
  assert.equal(m.code, "PART5");
  assert.equal(m.partner.userId, "P1");
  // Ίδιος κανόνας ποσού (partnerCodeDiscountCents) στον ξαναϋπολογισμό.
  assert.equal(C.partnerCodeDiscountCents(partsOf(plan.quote), m.partner, plan.quote.totalCents), 1500);
  const pricing = read("src/lib/bookingPricing.ts");
  assert.match(pricing, /req\.partnerCode && sameCode\(req\.discountCode, req\.partnerCode\.code\)/);
  const patch = read("src/app/api/bookings/[id]/route.ts");
  assert.match(patch, /partnerCode: existing\.partnerCode \?\? null,/);
  assert.match(patch, /keepsPartnerCode && partner\.partnerId !== current\.partnerId/);
  // Η εγγραφή του site: κωδικός + συνεργάτης από τον κωδικό.
  const write = read("src/lib/public/bookingWrite.ts");
  assert.match(write, /\.\.\.\(plan\.code \? \{ discountCode: plan\.code\.code \} : \{\}\),/);
  assert.match(write, /\.\.\.\(plan\.code\?\.partner \? \{ partnerId: plan\.code\.partner\.userId \} : \{\}\),/);
});

test("αλλαγή/αφαίρεση συνεργάτη στον κωδικό: ΜΟΝΟ νέες κρατήσεις· οι γραμμένες κρατούν την ανάλυσή τους", () => {
  const cat = makeCat();
  const old = planSiteBooking(cat, { ...REQ, discountCode: "PART5" }, [], NOW, rec()).plan;
  const oldStored = JSON.parse(JSON.stringify(old.stored)); // όπως γράφτηκε στη βάση
  // Ο Διαχειριστής αναθέτει τον κωδικό σε άλλον συνεργάτη (15%)…
  const moved = planSiteBooking(cat, { ...REQ, discountCode: "PART5" }, [], NOW, rec({ partnerId: "P2", partner: partner({ id: "P2", commissionRate: 15 }) })).plan;
  assert.equal(moved.code.partner.userId, "P2");
  // …ή τον κάνει κωδικό εταιρίας.
  const company = planSiteBooking(cat, { ...REQ, discountCode: "PART5" }, [], NOW, rec({ partnerId: null, partner: null })).plan;
  assert.equal(company.code.partner, null);
  assert.equal(company.stored.manualDiscount.partner, undefined);
  // Η παλιά κράτηση: ίδιος συνεργάτης, ίδια έκπτωση, ίδια μειωμένη προμήθεια (από το priceQuote της).
  const c = C.partnerCodeOf(oldStored);
  assert.equal(c.userId, "P1");
  assert.equal(c.cents, 1500);
  assert.equal(C.bookingCommission(partsOf(old.quote), SETTINGS20, c), 45);
});
