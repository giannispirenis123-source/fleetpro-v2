// tests/public-booking.test.mjs
// Δημόσιο site 3/4: ροή κράτησης — λογική υποβολής (bookingPlan), είσοδος
// (bookingRequest), εγγραφή (bookingWrite), όρια (rateLimit). Χωρίς βάση.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const { planSiteBooking, runSiteBooking, lockKeyFor, UNAVAILABLE_MESSAGE } = await import("../src/lib/public/bookingPlan.ts");
const {
  validateContact, checkAgeBand, isBot, publicBookingSchema, bookingTexts, maskEmail, toConfirmationDTO,
  normalizeBookingCode, isBookingCode, BOOKING_CODE_ALPHABET, cleanText, SITE_BOOKING_STATUS,
} = await import("../src/lib/public/bookingRequest.ts");
const { writeSiteBooking } = await import("../src/lib/public/bookingWrite.ts");
const { hitLimit, limitKey, LIMITS } = await import("../src/lib/public/rateLimit.ts");
const { countAvailableByGroup } = await import("../src/lib/public/availability.ts");
const { quoteFromContext, requestFromCriteria } = await import("../src/lib/public/engine.ts");
const { generateInvoiceCode, INVOICE_CODE_ALPHABET } = await import("../src/lib/invoiceCode.ts");

/* ─────────────────────────────────────────────
   Κατάλογος μιας εταιρίας (όπως το loadSiteCatalog)
   ───────────────────────────────────────────── */

const NOW = new Date("2026-10-15T06:00:00.000Z"); // 09:00 Ελλάδας

function makeCat(over = {}) {
  const groupTarget = { vehicleType: "car", rentalGroupId: "grpA", vehicleId: null, basePriceCents: 3000, depositCents: null, excessCents: 80000, minDriverAge: null };
  const ctx = {
    settings: { timezone: "Europe/Athens", graceMinutes: 59, afterHours: { start: "23:00", end: "07:00", feeCents: 0 }, oneWayFeeCents: null, minLeadHours: 3, maxAdvanceDays: 365, vatPercent: 24 },
    seasons: [{ id: "high", name: { el: "Υψηλή" }, startMonthDay: "07-01", endMonthDay: "08-31", minDays: 5, priority: 1 }],
    locations: [{ id: "L1", slug: "chania-airport", name: { el: "Αεροδρόμιο Χανίων" }, adjustmentType: "none", adjustmentValue: 0, adjustmentLabel: {}, afterHoursFeeCents: null, allowPickup: true, allowDropoff: true, isActive: true, needsFlight: true }],
    ageBands: [
      { minAge: 21, maxAge: 24, label: {}, explanation: {}, allowed: true, isDefault: false, surchargeType: "per_day", surchargeCents: 500, surchargeMaxCents: null },
      { minAge: 25, maxAge: 70, label: {}, explanation: {}, allowed: true, isDefault: true, surchargeType: "none", surchargeCents: 0, surchargeMaxCents: null },
    ],
    promotions: [],
    extras: [
      { id: "gps", kind: "EXTRA", isActive: true, isDefault: false, name: { el: "GPS" }, priceType: "per_rental", priceCents: 500, maxTotalCents: null, maxQuantity: 1, vehicleTypes: [] },
      { id: "moto-helmet", kind: "EXTRA", isActive: true, isDefault: false, name: { el: "Κράνος" }, priceType: "per_rental", priceCents: 300, maxTotalCents: null, maxQuantity: 2, vehicleTypes: ["moto"] },
    ],
    groups: new Map([["grpA", { target: groupTarget, rates: [] }]]),
    vehicles: new Map([
      ["v1", { target: { ...groupTarget, vehicleId: "v1" }, rates: [] }],
      ["v2", { target: { ...groupTarget, vehicleId: "v2" }, rates: [] }],
    ]),
  };
  const cv = (id, extra = {}) => ({ id, tenantId: "T1", rentalGroupId: "grpA", brand: "Fiat", model: "Panda", vehicleType: "car", seats: 4, doors: 5, transmission: "Manual", fuel: "PETROL", ac: true, photoUrl: null, status: "AVAILABLE", isActive: true, ...extra });
  return {
    companyId: "T1",
    ctx,
    groups: [{ id: "grpA", code: "A", vehicleType: "car", name: { el: "Μικρό" }, similarModels: {}, seats: 4, doors: 5, transmission: "manual", fuel: "PETROL", bagsLarge: 1, bagsSmall: 1, airCondition: true, engineCc: null, photoUrl: null, sortOrder: 0 }],
    vehicles: [cv("v1"), cv("v2")],
    rules: {
      timezone: "Europe/Athens", graceMinutes: 59, minLeadHours: 3, maxAdvanceDays: 365, defaultPickupTime: "10:00", defaultDropoffTime: "10:00", defaultRentalDays: 3,
      seasons: ctx.seasons,
      ageBands: ctx.ageBands.map((b) => ({ minAge: b.minAge, maxAge: b.maxAge, allowed: b.allowed, isDefault: b.isDefault, surchargeType: b.surchargeType })),
      locations: [{ slug: "chania-airport", allowPickup: true, allowDropoff: true }],
    },
    prepTimeMinutes: 0,
    ...over,
  };
}

const CRIT = { pl: "chania-airport", dl: null, from: "2026-11-02T10:00", to: "2026-11-05T10:00", age: 30 };
const REQ = { key: "g.A", criteria: CRIT, extras: [], insuranceId: undefined, driverAge: 30 };
const bk = (vehicleId, status = "PENDING", extra = {}) => ({ tenantId: "T1", vehicleId, status, pickupDate: "2026-11-01", pickupTime: "10:00", returnDate: "2026-11-06", returnTime: "10:00", ...extra });

/* ─────────────────────────────────────────────
   Διαθεσιμότητα με κρατήσεις του site
   ───────────────────────────────────────────── */

test("κράτηση του site (PENDING, με όχημα της ομάδας) μειώνει τα διαθέσιμα της ομάδας", () => {
  const cat = makeCat();
  const fleet = cat.vehicles.map((v) => ({ id: v.id, tenantId: "T1", groupKey: "g.A", status: v.status, isActive: true }));
  const count = (bookings) => countAvailableByGroup({ companyId: "T1", vehicles: fleet, bookings, from: CRIT.from, to: CRIT.to, prepMinutes: 0 }).get("g.A");
  assert.equal(count([]), 2);
  assert.equal(count([bk("v1")]), 1, "η κράτηση του site κλείνει όχημα της ομάδας");
  assert.equal(count([bk("v1"), bk("v2")]), 0);
  // Το επόμενο αίτημα για την ίδια ομάδα παίρνει «δεν είναι διαθέσιμο».
  const r = planSiteBooking(cat, REQ, [bk("v1"), bk("v2")], NOW);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "UNAVAILABLE");
  assert.deepEqual(r.error.message, UNAVAILABLE_MESSAGE);
});

test("ανάθεση οχήματος: το ελεύθερο όχημα της ομάδας", () => {
  const r = planSiteBooking(makeCat(), REQ, [bk("v1")], NOW);
  assert.equal(r.ok, true);
  assert.equal(r.plan.vehicleId, "v2");
  assert.equal(r.plan.rentalGroupId, "grpA");
});

/* ─────────────────────────────────────────────
   Ταυτόχρονες υποβολές για το ΤΕΛΕΥΤΑΙΟ όχημα
   ───────────────────────────────────────────── */

/** Ψεύτικη «βάση»: κρατήσεις σε μνήμη + κλείδωμα ανά κλειδί (όπως το pg_advisory_xact_lock). */
function memoryStore({ withRealLock }) {
  const bookings = [bk("v1")]; // μένει ΜΟΝΟ το v2
  const locks = new Map();
  const tick = () => new Promise((r) => setTimeout(r, 5));
  return {
    bookings,
    async withLock(key, fn) {
      if (!withRealLock) return fn({});
      const prev = locks.get(key) ?? Promise.resolve();
      let release;
      const mine = new Promise((r) => (release = r));
      locks.set(key, prev.then(() => mine));
      await prev;
      try {
        return await fn({});
      } finally {
        release();
      }
    },
    async loadBookings() {
      await tick(); // ο χρόνος ανάμεσα σε «διάβασε» και «γράψε»
      return bookings.slice();
    },
    async write(_tx, plan) {
      await tick();
      bookings.push(bk(plan.vehicleId));
      return generateInvoiceCode();
    },
  };
}

test("ταυτόχρονες υποβολές για το τελευταίο όχημα: με κλείδωμα περνά ΜΟΝΟ μία", async () => {
  const store = memoryStore({ withRealLock: true });
  const results = await Promise.all([runSiteBooking(store, makeCat(), REQ, NOW), runSiteBooking(store, makeCat(), REQ, NOW)]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  const failed = results.find((r) => !r.ok);
  assert.equal(failed.error.code, "UNAVAILABLE");
  assert.match(failed.error.message.el, /δεν είναι πια διαθέσιμο/);
  assert.equal(store.bookings.filter((b) => b.vehicleId === "v2").length, 1, "καμία διπλή κράτηση");
  assert.equal(lockKeyFor("T1"), "site-booking:T1");
});

test("(έλεγχος του test) χωρίς κλείδωμα θα περνούσαν και οι δύο — γι' αυτό υπάρχει", async () => {
  const store = memoryStore({ withRealLock: false });
  const results = await Promise.all([runSiteBooking(store, makeCat(), REQ, NOW), runSiteBooking(store, makeCat(), REQ, NOW)]);
  assert.equal(results.filter((r) => r.ok).length, 2);
});

/* ─────────────────────────────────────────────
   Τιμή: ΜΟΝΟ από τον server· snapshot της quote
   ───────────────────────────────────────────── */

test("ο server αγνοεί τιμή από τον client και αποθηκεύει το snapshot της quote()", () => {
  const body = {
    slug: "fleet", lang: "el", key: "g.A", criteria: CRIT, extras: [{ id: "gps", qty: 1 }],
    firstName: "Γιάννης", lastName: "Π", email: "g@example.com", phoneCountry: "+30", phone: "6900000000",
    birthDate: "1990-01-01", acceptTerms: true,
    // Απόπειρα να «στείλει» τιμή:
    totalCents: 100, total: 1, price: 1, priceQuote: { totalCents: 100 },
  };
  const parsed = publicBookingSchema.parse(body);
  for (const k of ["totalCents", "total", "price", "priceQuote"]) assert.ok(!(k in parsed), `το ${k} πετιέται`);
  const cat = makeCat();
  const r = planSiteBooking(cat, { ...REQ, extras: parsed.extras }, [], NOW);
  const direct = quoteFromContext(cat.ctx, { ...requestFromCriteria(cat.ctx, cat.groups, "g.A", CRIT), extras: [{ id: "gps", qty: 1 }] }).result;
  assert.equal(r.plan.quote.totalCents, direct.totalCents);
  assert.equal(r.plan.quote.totalCents, 9500, "3 × 30 € + GPS 5 €");
  assert.deepEqual(r.plan.stored.quote.lines, direct.lines, "ολόκληρη η ανάλυση");
  assert.equal(r.plan.stored.autoPrice, true);
  assert.equal(r.plan.breakdown.total, 95);
});

test("extra που δεν επιτρέπεται για τον τύπο → απορρίπτεται", () => {
  const r = planSiteBooking(makeCat(), { ...REQ, extras: [{ id: "moto-helmet", qty: 1 }] }, [], NOW);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "INVALID");
});

/* ─────────────────────────────────────────────
   Έλεγχοι εισόδου
   ───────────────────────────────────────────── */

const C = { firstName: "Γιάννης", lastName: "Πυρηνής", email: "Giannis@Example.com ", phoneCountry: "+30", phone: "690 000 0000", birthDate: "1990-05-01", flightNumber: "a3 123", notes: "<b>Παιδικό κάθισμα</b> παρακαλώ", acceptTerms: true };

test("στοιχεία: καθάρισμα (πεζά email, τηλέφωνο με κωδικό, πτήση, χωρίς HTML)", () => {
  const r = validateContact(C, { needsFlight: true, pickupDate: "2026-11-02" });
  assert.equal(r.ok, true);
  assert.equal(r.contact.email, "giannis@example.com");
  assert.equal(r.contact.phone, "+30 6900000000");
  assert.equal(r.contact.flightNumber, "A3 123");
  assert.equal(r.contact.notes, "Παιδικό κάθισμα παρακαλώ");
  assert.equal(validateContact(C, { needsFlight: false, pickupDate: "2026-11-02" }).contact.flightNumber, null, "πτήση μόνο όταν τη ζητά το σημείο");
  assert.equal(cleanText("<script>alert(1)</script>x", 50), "alert(1) x");
});

test("στοιχεία: λάθος email, τηλέφωνο, ημερομηνία, πτήση, όροι → μήνυμα ανά πεδίο", () => {
  const bad = validateContact(
    { ...C, firstName: "Γ", email: "not-an-email", phone: "12", birthDate: "2030-01-01", flightNumber: "!!", acceptTerms: false },
    { needsFlight: true, pickupDate: "2026-11-02" }
  );
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.field).sort(), ["acceptTerms", "birthDate", "email", "firstName", "flightNumber", "phone"]);
  assert.ok(bad.errors.every((e) => e.message.el && e.message.en));
  assert.equal(validateContact({ ...C, phoneCountry: "+999" }, { needsFlight: false, pickupDate: "2026-11-02" }).ok, false, "άγνωστος κωδικός χώρας");
});

test("ηλικία vs κλίμακα της αναζήτησης", () => {
  const bands = makeCat().rules.ageBands;
  assert.deepEqual(checkAgeBand("1990-01-01", "2026-11-02", 30, bands), { ok: true, age: 36 });
  assert.deepEqual(checkAgeBand("1990-01-01", "2026-11-02", null, bands), { ok: true, age: 36 }, "χωρίς ηλικία = η προεπιλεγμένη κλίμακα");
  const young = checkAgeBand("2004-01-01", "2026-11-02", 30, bands);
  assert.deepEqual(young, { ok: false, actualAge: 22, allowed: true }, "22 ≠ κλίμακα 25–70 → «Ενημέρωση τιμής» με 22");
  assert.deepEqual(checkAgeBand("2008-01-01", "2026-11-02", 30, bands), { ok: false, actualAge: 18, allowed: false });
  assert.deepEqual(checkAgeBand("2008-01-01", "2026-11-02", null, []), { ok: true, age: 18 }, "χωρίς κλίμακες στην εταιρία");
});

test("ο server ξανατρέχει minDays, παρελθόν, προθεσμία (search.ts)", () => {
  const cat = makeCat();
  const past = planSiteBooking(cat, { ...REQ, criteria: { ...CRIT, from: "2026-10-14T10:00", to: "2026-10-17T10:00" } }, [], NOW);
  assert.equal(past.error.code, "INVALID");
  assert.match(past.error.message.el, /παρελθόν/);
  const lead = planSiteBooking(cat, { ...REQ, criteria: { ...CRIT, from: "2026-10-15T10:00", to: "2026-10-18T10:00" } }, [], NOW);
  assert.match(lead.error.message.el, /τουλάχιστον 3 ώρες/);
  const minDays = planSiteBooking(cat, { ...REQ, criteria: { ...CRIT, from: "2027-07-01T10:00", to: "2027-07-03T10:00" } }, [], NOW);
  assert.match(minDays.error.message.el, /Ελάχιστη διάρκεια 5/);
});

/* ─────────────────────────────────────────────
   Tenant isolation
   ───────────────────────────────────────────── */

test("tenant isolation: ομάδα / οχήματα / κρατήσεις άλλης εταιρίας", () => {
  const cat = makeCat();
  assert.equal(planSiteBooking(cat, { ...REQ, key: "g.OTHER" }, [], NOW).error.code, "NOT_FOUND", "ομάδα που δεν είναι της εταιρίας");
  // Οχήματα άλλης εταιρίας στη λίστα δεν μετρούν, κρατήσεις άλλης εταιρίας δεν κλείνουν.
  const mixed = makeCat({ vehicles: [...makeCat().vehicles.map((v) => ({ ...v, tenantId: "T2" }))] });
  assert.equal(planSiteBooking(mixed, REQ, [], NOW).error.code, "UNAVAILABLE");
  const r = planSiteBooking(cat, REQ, [bk("v1", "CONFIRMED", { tenantId: "T2" }), bk("v2", "CONFIRMED", { tenantId: "T2" })], NOW);
  assert.equal(r.ok, true, "κρατήσεις της T2 δεν κλείνουν οχήματα της T1");
});

/* ─────────────────────────────────────────────
   Κωδικός κράτησης
   ───────────────────────────────────────────── */

test("κωδικός: μορφή XXXX-XXXX, ίδιο αλφάβητο με το τιμολόγιο, μοναδικός στην πράξη", () => {
  assert.equal(BOOKING_CODE_ALPHABET, INVOICE_CODE_ALPHABET);
  const set = new Set();
  for (let i = 0; i < 5000; i++) {
    const c = generateInvoiceCode();
    assert.ok(isBookingCode(c), c);
    set.add(c);
  }
  assert.equal(set.size, 5000);
  assert.equal(normalizeBookingCode("k7m2x9pq"), "K7M2-X9PQ");
  assert.equal(normalizeBookingCode("K7M2-X9P0"), null, "0 δεν υπάρχει στο αλφάβητο");
  assert.equal(normalizeBookingCode("../etc"), null);
});

test("κωδικός: σε σύγκρουση με υπάρχοντα, νέος", async () => {
  const codes = ["AAAA-AAAA", "BBBB-BBBB"];
  const created = [];
  const tx = fakeTx({ existingCustomer: null, takenCodes: new Set(["AAAA-AAAA"]), created });
  const code = await writeSiteBooking(tx, writeInput(), { nextNumber: async () => "BP-2026-001", generateCode: () => codes.shift() });
  assert.equal(code, "BBBB-BBBB");
});

/* ─────────────────────────────────────────────
   Honeypot + όρια κατάχρησης
   ───────────────────────────────────────────── */

test("honeypot: γεμάτο κρυφό πεδίο = bot", () => {
  assert.equal(isBot({ website: "" }), false);
  assert.equal(isBot({ website: "http://spam" }), true);
});

test("όρια: 5 υποβολές/ώρα ανά email, μετά όχι· κλειδί χωρίς email/IP σε καθαρή μορφή", async () => {
  const counts = new Map();
  const store = { increment: async (key, ws) => { const k = `${key}@${ws.toISOString()}`; counts.set(k, (counts.get(k) ?? 0) + 1); return counts.get(k); } };
  const results = [];
  for (let i = 0; i < 6; i++) results.push(await hitLimit(store, LIMITS.bookingPerEmail, "T1|g@example.com", NOW));
  assert.deepEqual(results, [true, true, true, true, true, false]);
  assert.equal(await hitLimit(store, LIMITS.bookingPerEmail, "T1|other@example.com", NOW), true, "άλλο email, άλλος μετρητής");
  assert.equal(await hitLimit(store, LIMITS.bookingPerEmail, "T1|g@example.com", new Date(NOW.getTime() + 3_600_000)), true, "νέα ώρα, νέο παράθυρο");
  const key = limitKey("book-email", "T1|g@example.com", "secret");
  assert.ok(!key.includes("example") && !key.includes("@"));
  assert.match(limitKey("booking-view", "203.0.113.5", "secret"), /^booking-view:[0-9a-f]{40}$/);
});

/* ─────────────────────────────────────────────
   Σελίδα επιβεβαίωσης: μόνο δημόσια πεδία
   ───────────────────────────────────────────── */

test("DTO επιβεβαίωσης: μικρό όνομα + μασκαρισμένο email, ΠΟΤΕ τηλέφωνο/ηλικία/σχόλια/πτήση", () => {
  const dto = toConfirmationDTO({
    publicCode: "K7M2-X9PQ", status: "PENDING",
    pickupDate: new Date("2026-11-02T00:00:00Z"), pickupTime: "10:00", returnDate: new Date("2026-11-05T00:00:00Z"), returnTime: "10:00",
    pickupLocation: "Αεροδρόμιο Χανίων", returnLocation: "Αεροδρόμιο Χανίων",
    priceQuote: { totalCents: 9500, quote: { lines: [{ kind: "rental", label: { el: "Ενοίκιο" }, qty: 3, unitCents: 3000, totalCents: 9000 }], vatCents: 1839, listTotalCents: 9500, depositCents: null, excessCents: 80000 } },
    total: 95,
    customer: { firstName: "Γιάννης", email: "giannis@gmail.com", phone: "+30 6900000000", lastName: "Π", dateOfBirth: "1990-01-01" },
    flightNumber: "A3 123", notes: "μυστικό σχόλιο",
    groupName: "Μικρό", groupSimilar: "Fiat Panda", photoUrl: null,
  });
  assert.deepEqual(Object.keys(dto).sort(), [
    "cancelNote", "cancelReasonCode", "code", "depositCents", "excessCents", "firstName", "from", "groupName", "groupSimilar", "lines", "listTotalCents",
    "maskedEmail", "photoUrl", "pickupLocation", "returnLocation", "status", "to", "totalCents", "vatCents",
  ]);
  assert.equal(dto.maskedEmail, "g******@gmail.com");
  assert.equal(dto.totalCents, 9500, "από το ΑΠΟΘΗΚΕΥΜΕΝΟ priceQuote");
  const json = JSON.stringify(dto);
  for (const secret of ["6900000000", "1990", "A3 123", "μυστικό", "giannis@", "Π\""]) assert.ok(!json.includes(secret), `διαρροή: ${secret}`);
  assert.equal(maskEmail("ab@x.gr"), "a***@x.gr");
  assert.equal(maskEmail(null), "");
});

/* ─────────────────────────────────────────────
   Υπάρχων πελάτης: δεν αλλοιώνεται
   ───────────────────────────────────────────── */

function fakeTx({ existingCustomer, takenCodes = new Set(), created }) {
  return {
    customer: {
      findFirst: async (args) => {
        created.push(["customer.findFirst", args]);
        return existingCustomer;
      },
      create: async (args) => {
        created.push(["customer.create", args]);
        return { id: "newCustomer" };
      },
      update: async () => {
        throw new Error("ΔΕΝ επιτρέπεται ενημέρωση υπάρχοντος πελάτη");
      },
    },
    booking: {
      findUnique: async ({ where }) => (takenCodes.has(where.publicCode) ? { id: "x" } : null),
      create: async (args) => {
        created.push(["booking.create", args]);
        return { id: "b1" };
      },
    },
    notification: { create: async (args) => created.push(["notification.create", args]) },
  };
}

function writeInput() {
  const plan = planSiteBooking(makeCat(), REQ, [], NOW).plan;
  return {
    tenantId: "T1",
    plan,
    contact: { firstName: "Νέο", lastName: "Όνομα", email: "g@example.com", phone: "+30 6911111111", birthDate: "1990-01-01", flightNumber: "A3 123", notes: "Σχόλιο" },
    locations: { pickup: "Αεροδρόμιο Χανίων", dropoff: null },
    window: { from: CRIT.from, to: CRIT.to },
  };
}

test("υπάρχων πελάτης (ίδιο email, ίδια εταιρία): χρησιμοποιείται ΩΣ ΕΧΕΙ", async () => {
  const created = [];
  const tx = fakeTx({ existingCustomer: { id: "cust_old" }, created });
  await writeSiteBooking(tx, writeInput(), { nextNumber: async () => "BP-2026-007", generateCode: () => "K7M2-X9PQ" });
  assert.ok(!created.some(([op]) => op === "customer.create"), "δεν φτιάχνεται νέος");
  const find = created.find(([op]) => op === "customer.findFirst")[1];
  assert.equal(find.where.tenantId, "T1", "αναζήτηση ΜΟΝΟ στην εταιρία");
  assert.equal(find.where.email.mode, "insensitive");
  const booking = created.find(([op]) => op === "booking.create")[1].data;
  assert.equal(booking.customerId, "cust_old");
  assert.equal(booking.status, SITE_BOOKING_STATUS);
  assert.equal(booking.status, "PENDING");
  assert.equal(booking.source, "site");
  assert.equal(booking.priceMode, "AUTO");
  assert.equal(booking.publicCode, "K7M2-X9PQ");
  assert.equal(booking.rentalGroupId, "grpA");
  assert.equal(booking.flightNumber, "A3 123");
  assert.ok(booking.priceQuote.quote.lines.length > 0);
  const note = created.find(([op]) => op === "notification.create")[1].data;
  assert.equal(note.type, "BOOKING_NEW");
  assert.equal(note.title, "Νέα κράτηση από το site");
});

test("νέος πελάτης: ΜΟΝΟ τα στοιχεία που έδωσε", async () => {
  const created = [];
  await writeSiteBooking(fakeTx({ existingCustomer: null, created }), writeInput(), { nextNumber: async () => "BP-2026-008", generateCode: () => "K7M2-X9PQ" });
  const data = created.find(([op]) => op === "customer.create")[1].data;
  assert.deepEqual(Object.keys(data).sort(), ["dateOfBirth", "email", "firstName", "lastName", "phone", "tenantId"]);
});

/* ─────────────────────────────────────────────
   Τρόπος κράτησης: μόνο το κείμενο αλλάζει
   ───────────────────────────────────────────── */

test("rentalMode BOOKING / REQUEST: ίδια κατάσταση (PENDING), άλλο κείμενο", () => {
  assert.equal(bookingTexts("BOOKING").submit.el, "Υποβολή κράτησης");
  assert.equal(bookingTexts("REQUEST").submit.el, "Αποστολή αιτήματος");
  assert.equal(bookingTexts("BOOKING").submit.en, "Submit booking");
  assert.equal(bookingTexts("REQUEST").submit.en, "Send request");
  assert.notEqual(bookingTexts("BOOKING").done.el, bookingTexts("REQUEST").done.el);
  assert.equal(SITE_BOOKING_STATUS, "PENDING");
});
