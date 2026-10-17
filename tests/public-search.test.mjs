// tests/public-search.test.mjs
// Δημόσιο site PR 2: αναζήτηση (search.ts), διαθεσιμότητα (availability.ts)
// και κάρτες (catalog.ts). Τρέχει με `npm test` (node:test), χωρίς βάση.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Τα .ts του src εισάγουν σχετικά αρχεία χωρίς κατάληξη ("./pricing").
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const { intervalsConflict, wallClockMs, countAvailableByGroup, bookingInterval, loadBlockingBookings, BLOCKING_STATUSES } =
  await import("../src/lib/public/availability.ts");
const {
  validateCriteria,
  defaultCriteria,
  parseCriteria,
  criteriaToQuery,
  nowLocal,
  addDays,
  minDaysFor,
  defaultAge,
  TIME_SLOTS,
  hasSearch,
} = await import("../src/lib/public/search.ts");
const { buildCards, typeTabs, filterByType, sortCards, vehicleCardKey, isCardKey, similarModelName } = await import("../src/lib/public/catalog.ts");
const { textFor } = await import("../src/lib/public/text.ts");
const { htmlLang } = await import("../src/lib/storefront/lang.ts");
const { formatDay, storefrontDictionary } = await import("../src/lib/storefront/i18n.ts");

const H = 3_600_000;

/* ─────────────────────────────────────────────
   Επικάλυψη διαστημάτων
   ───────────────────────────────────────────── */

const iv = (a, b) => ({ start: Date.parse(`${a}:00.000Z`), end: Date.parse(`${b}:00.000Z`) });

test("επικάλυψη: ίδια ώρα επιστροφής/παραλαβής ΔΕΝ συγκρούεται (χωρίς προετοιμασία)", () => {
  const booked = iv("2026-07-01T10:00", "2026-07-04T10:00");
  assert.equal(intervalsConflict(iv("2026-07-04T10:00", "2026-07-06T10:00"), booked), false, "παραλαβή τη στιγμή της επιστροφής");
  assert.equal(intervalsConflict(iv("2026-06-28T10:00", "2026-07-01T10:00"), booked), false, "επιστροφή τη στιγμή της παραλαβής");
});

test("επικάλυψη: ένα λεπτό μέσα = σύγκρουση· περιέχει / περιέχεται", () => {
  const booked = iv("2026-07-01T10:00", "2026-07-04T10:00");
  assert.equal(intervalsConflict(iv("2026-07-04T09:59", "2026-07-06T10:00"), booked), true);
  assert.equal(intervalsConflict(iv("2026-06-30T10:00", "2026-07-01T10:01"), booked), true);
  assert.equal(intervalsConflict(iv("2026-07-02T10:00", "2026-07-03T10:00"), booked), true, "μέσα");
  assert.equal(intervalsConflict(iv("2026-06-01T10:00", "2026-08-01T10:00"), booked), true, "γύρω");
});

test("επικάλυψη: ο χρόνος προετοιμασίας μετρά και από τις δύο πλευρές", () => {
  const booked = iv("2026-07-01T10:00", "2026-07-04T10:00");
  assert.equal(intervalsConflict(iv("2026-07-04T10:30", "2026-07-06T10:00"), booked, H), true, "30΄ μετά, θέλει 60΄");
  assert.equal(intervalsConflict(iv("2026-07-04T11:00", "2026-07-06T10:00"), booked, H), false, "ακριβώς 60΄");
  assert.equal(intervalsConflict(iv("2026-06-29T10:00", "2026-07-01T09:30"), booked, H), true, "πριν, χωρίς κενό");
});

test("κράτηση χωρίς ώρα = όλη η ημέρα (συντηρητικά)", () => {
  assert.equal(wallClockMs("2026-07-01", null, "start"), Date.parse("2026-07-01T00:00:00.000Z"));
  assert.equal(wallClockMs("2026-07-01", null, "end"), Date.parse("2026-07-01T23:59:00.000Z"));
  assert.equal(wallClockMs("2026-07-01", "25:00", "start"), Date.parse("2026-07-01T00:00:00.000Z"), "άκυρη ώρα");
});

test("ACTIVE σε καθυστέρηση κρατά το όχημα μέχρι «τώρα»", () => {
  const b = { tenantId: "t", vehicleId: "v", status: "ACTIVE", pickupDate: "2026-07-01", pickupTime: "10:00", returnDate: "2026-07-03", returnTime: "10:00" };
  const now = Date.parse("2026-07-05T12:00:00.000Z");
  assert.equal(bookingInterval(b, now).end, now);
  assert.equal(bookingInterval({ ...b, status: "CONFIRMED" }, now).end, Date.parse("2026-07-03T10:00:00.000Z"));
});

/* ─────────────────────────────────────────────
   Μέτρημα διαθέσιμων ανά ομάδα + tenant isolation
   ───────────────────────────────────────────── */

const veh = (id, groupKey, extra = {}) => ({ id, tenantId: "T1", groupKey, status: "AVAILABLE", isActive: true, ...extra });
const bk = (vehicleId, status, from, to, extra = {}) => ({
  tenantId: "T1",
  vehicleId,
  status,
  pickupDate: from.slice(0, 10),
  pickupTime: from.slice(11),
  returnDate: to.slice(0, 10),
  returnTime: to.slice(11),
  ...extra,
});

const FLEET = [
  veh("a1", "g.A"),
  veh("a2", "g.A"),
  veh("a3", "g.A"),
  veh("a4", "g.A", { status: "MAINTENANCE" }),
  veh("a5", "g.A", { status: "INACTIVE" }),
  veh("b1", "g.B"),
  veh("b2", "g.B"),
  veh("x1", "v.x1"),
];

const count = (bookings, extra = {}) =>
  countAvailableByGroup({
    companyId: "T1",
    vehicles: FLEET,
    bookings,
    from: "2026-07-10T10:00",
    to: "2026-07-13T10:00",
    prepMinutes: 0,
    ...extra,
  });

test("διαθέσιμα ανά ομάδα: service/ανενεργά δεν μετρούν", () => {
  const c = count([]);
  assert.equal(c.get("g.A"), 3);
  assert.equal(c.get("g.B"), 2);
  assert.equal(c.get("v.x1"), 1);
});

test("διαθέσιμα: PENDING / CONFIRMED / ACTIVE κλείνουν, CANCELLED / COMPLETED όχι", () => {
  assert.deepEqual([...BLOCKING_STATUSES], ["PENDING", "CONFIRMED", "ACTIVE"]);
  const c = count([
    bk("a1", "PENDING", "2026-07-09T10:00", "2026-07-11T10:00"),
    bk("a2", "CANCELLED", "2026-07-09T10:00", "2026-07-11T10:00"),
    bk("a3", "COMPLETED", "2026-07-09T10:00", "2026-07-11T10:00"),
    bk("b1", "CONFIRMED", "2026-07-12T09:00", "2026-07-15T10:00"),
    bk("b2", "ACTIVE", "2026-07-01T10:00", "2026-07-11T10:00"),
  ]);
  assert.equal(c.get("g.A"), 2);
  assert.equal(c.get("g.B"), 0);
});

test("διαθέσιμα: επιστροφή στην ώρα της νέας παραλαβής → διαθέσιμο· με προετοιμασία → όχι", () => {
  const bookings = [bk("b1", "CONFIRMED", "2026-07-05T10:00", "2026-07-10T10:00"), bk("b2", "CONFIRMED", "2026-07-13T10:00", "2026-07-20T10:00")];
  assert.equal(count(bookings).get("g.B"), 2);
  assert.equal(count(bookings, { prepMinutes: 30 }).get("g.B"), 0);
});

test("διαθέσιμα: αλλαγή οχήματος στο συμβόλαιο κλείνει και το δεύτερο όχημα", () => {
  const c = count([bk("a1", "ACTIVE", "2026-07-09T10:00", "2026-07-12T10:00", { extraVehicleIds: ["a2"] })]);
  assert.equal(c.get("g.A"), 1);
});

test("διαθέσιμα: καθυστέρηση ACTIVE κλείνει όχημα μέχρι τώρα", () => {
  const late = [bk("x1", "ACTIVE", "2026-07-01T10:00", "2026-07-08T10:00")];
  assert.equal(count(late, { now: "2026-07-07T10:00" }).get("v.x1"), 1, "δεν έχει καθυστερήσει ακόμα");
  assert.equal(count(late, { now: "2026-07-11T08:00" }).get("v.x1"), 0, "αργεί → όχι διαθέσιμο");
});

test("tenant isolation: οχήματα και κρατήσεις ΑΛΛΗΣ εταιρίας δεν μετράνε", () => {
  const vehicles = [...FLEET, { id: "z1", tenantId: "T2", groupKey: "g.A", status: "AVAILABLE", isActive: true }];
  const c = countAvailableByGroup({
    companyId: "T1",
    vehicles,
    bookings: [
      // Ίδιο vehicleId, άλλη εταιρία: δεν κλείνει το όχημα της T1.
      { ...bk("a1", "CONFIRMED", "2026-07-09T10:00", "2026-07-12T10:00"), tenantId: "T2" },
    ],
    from: "2026-07-10T10:00",
    to: "2026-07-13T10:00",
    prepMinutes: 0,
  });
  assert.equal(c.get("g.A"), 3, "ούτε το z1 της T2 προστίθεται ούτε η κράτηση της T2 αφαιρεί");
});

test("ΕΝΑ ερώτημα ανά αναζήτηση, φιλτραρισμένο με την εταιρία", async () => {
  const calls = [];
  const client = {
    booking: {
      findMany: async (args) => {
        calls.push(args);
        return [
          {
            id: "b1",
            tenantId: "T1",
            vehicleId: "a1",
            status: "ACTIVE",
            pickupDate: new Date("2026-07-09T00:00:00.000Z"),
            pickupTime: "10:00",
            returnDate: new Date("2026-07-12T00:00:00.000Z"),
            returnTime: null,
            contract: { vehicleChanges: [{ vehicleId: "a2", plate: "SECRET" }, { foo: 1 }] },
          },
        ];
      },
    },
  };
  const rows = await loadBlockingBookings(client, "T1", { from: "2026-07-10T10:00", to: "2026-07-13T10:00" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.tenantId, "T1");
  assert.deepEqual(calls[0].where.status.in, ["PENDING", "CONFIRMED", "ACTIVE"]);
  assert.ok(!("plate" in calls[0].select) && !("customerId" in calls[0].select), "μόνο τα απαραίτητα πεδία");
  assert.deepEqual(rows[0], {
    id: "b1",
    tenantId: "T1",
    vehicleId: "a1",
    status: "ACTIVE",
    pickupDate: "2026-07-09",
    pickupTime: "10:00",
    returnDate: "2026-07-12",
    returnTime: null,
    extraVehicleIds: ["a2"],
    paymentStatus: undefined,
    paymentExpiresMs: null,
  });
  // Ληγμένη αναμονή online πληρωμής: έξω ήδη από το ερώτημα.
  assert.ok(calls[0].where.NOT?.paymentStatus === "AWAITING_PAYMENT", "χωρίς ληγμένες αναμονές πληρωμής");
});

/* ─────────────────────────────────────────────
   Αναζήτηση: ζώνη ώρας, προεπιλογές, έλεγχοι
   ───────────────────────────────────────────── */

const RULES = {
  timezone: "Europe/Athens",
  graceMinutes: 59,
  minLeadHours: 3,
  maxAdvanceDays: 365,
  defaultPickupTime: "10:00",
  defaultDropoffTime: "10:00",
  defaultRentalDays: 3,
  seasons: [
    { id: "high", name: { el: "Υψηλή", en: "High" }, startMonthDay: "07-01", endMonthDay: "08-31", minDays: 5, priority: 1 },
    { id: "low", name: { el: "Χαμηλή" }, startMonthDay: "09-01", endMonthDay: "06-30", minDays: null, priority: 0 },
  ],
  ageBands: [
    { minAge: 18, maxAge: 20, allowed: false, isDefault: false, surchargeType: "none" },
    { minAge: 21, maxAge: 24, allowed: true, isDefault: false, surchargeType: "per_day" },
    { minAge: 25, maxAge: 70, allowed: true, isDefault: true, surchargeType: "none" },
    { minAge: 71, maxAge: 80, allowed: true, isDefault: false, surchargeType: "per_rental" },
  ],
  locations: [
    { slug: "chania-airport", allowPickup: true, allowDropoff: true },
    { slug: "kissamos", allowPickup: true, allowDropoff: true },
    { slug: "return-only", allowPickup: false, allowDropoff: true },
  ],
};

// 14/10/2026 09:00 ώρα Ελλάδας (UTC+3) = 06:00 UTC.
const NOW = new Date("2026-10-14T06:00:00.000Z");
const crit = (from, to, extra = {}) => ({ pl: "chania-airport", dl: "chania-airport", from, to, age: 25, type: null, ...extra });
const codes = (c, now = NOW) => validateCriteria(c, RULES, now).map((p) => p.code);

test("ζώνη ώρας: «τώρα» και «σήμερα» σε ώρα Ελλάδας, όχι του browser/UTC", () => {
  assert.equal(nowLocal("Europe/Athens", NOW), "2026-10-14T09:00");
  // 22:30 UTC = 01:30 της επόμενης ημέρας στην Ελλάδα (UTC+3).
  assert.equal(nowLocal("Europe/Athens", new Date("2026-10-14T22:30:00.000Z")), "2026-10-15T01:30");
  // Χειμερινή ώρα (UTC+2): 23 Δεκ 22:30 UTC = 24 Δεκ 00:30.
  assert.equal(nowLocal("Europe/Athens", new Date("2026-12-23T22:30:00.000Z")), "2026-12-24T00:30");
  assert.equal(nowLocal("Invalid/Zone", NOW), "2026-10-14T09:00", "άκυρη ζώνη → Αθήνα");
});

test("ζώνη ώρας: το «παρελθόν» κρίνεται με ώρα Ελλάδας", () => {
  // 06:00 UTC = 09:00 Ελλάδας: παραλαβή 08:30 σήμερα είναι ήδη παρελθόν, παρότι σε UTC θα ήταν μέλλον.
  assert.deepEqual(codes(crit("2026-10-14T08:30", "2026-10-17T10:00")), ["PAST"]);
});

test("προεπιλογές: αύριο 10:00 → +3 ημέρες 10:00, ηλικία της προεπιλογής", () => {
  const c = defaultCriteria(RULES, NOW);
  assert.equal(c.from, "2026-10-15T10:00");
  assert.equal(c.to, "2026-10-18T10:00");
  assert.equal(c.age, 25);
  assert.equal(c.pl, "chania-airport");
  assert.equal(c.dl, null, "η επιστροφή ΔΕΝ προεπιλέγεται");
  assert.deepEqual(validateCriteria(c, RULES, NOW).map((p) => p.field), ["dl"], "μόνο η επιστροφή λείπει");
  assert.deepEqual(validateCriteria({ ...c, dl: c.pl }, RULES, NOW), [], "με επιστροφή οι προεπιλογές περνούν");
});

test("προεπιλογές: minDays μεγαλύτερο από 3 → επιστροφή μετά από minDays", () => {
  const c = defaultCriteria(RULES, new Date("2026-07-10T06:00:00.000Z"));
  assert.equal(c.from, "2026-07-11T10:00");
  assert.equal(c.to, "2026-07-16T10:00", "υψηλή σεζόν: 5 ημέρες");
  assert.equal(minDaysFor("2026-07-11", RULES.seasons), 5);
  assert.equal(minDaysFor("2026-10-11", RULES.seasons), 1);
});

test("προεπιλογές: η ελάχιστη προθεσμία μεταθέτει την παραλαβή", () => {
  const c = defaultCriteria({ ...RULES, minLeadHours: 48 }, NOW);
  assert.equal(c.from, "2026-10-16T10:00", "τώρα 14/10 09:00 + 48ω → 16/10 10:00");
  assert.equal(defaultCriteria({ ...RULES, minLeadHours: 50 }, NOW).from, "2026-10-17T10:00");
});

test("ηλικία προεπιλογής: isDefault, αλλιώς η πρώτη χωρίς επιβάρυνση", () => {
  assert.equal(defaultAge(RULES.ageBands), 25);
  assert.equal(defaultAge(RULES.ageBands.map((b) => ({ ...b, isDefault: false }))), 25);
  assert.equal(defaultAge([]), null);
});

test("έλεγχοι: επιστροφή πριν την παραλαβή", () => {
  assert.deepEqual(codes(crit("2026-10-20T10:00", "2026-10-20T09:00")), ["ORDER"]);
  assert.deepEqual(codes(crit("2026-10-20T10:00", "2026-10-20T10:00")), ["ORDER"]);
});

test("έλεγχοι: ελάχιστη προθεσμία και μέγιστη απόσταση", () => {
  assert.deepEqual(codes(crit("2026-10-14T11:00", "2026-10-17T10:00")), ["LEAD_TIME"]);
  assert.deepEqual(codes(crit("2027-11-14T11:00", "2027-11-17T10:00")), ["TOO_FAR"]);
});

test("έλεγχοι: minDays της σεζόν παραλαβής (με grace 59΄ όπως η quote())", () => {
  assert.deepEqual(codes(crit("2027-07-01T10:00", "2027-07-05T10:00"), new Date("2027-06-01T06:00:00.000Z")), ["MIN_DAYS"]);
  assert.deepEqual(codes(crit("2027-07-01T10:00", "2027-07-06T10:00"), new Date("2027-06-01T06:00:00.000Z")), []);
  assert.deepEqual(codes(crit("2027-07-01T10:00", "2027-07-06T10:59"), new Date("2027-06-01T06:00:00.000Z")), [], "μέσα στο grace");
  const msg = validateCriteria(crit("2027-07-01T10:00", "2027-07-03T10:00"), RULES, new Date("2027-06-01T06:00:00.000Z"))[0].message;
  assert.match(msg.el, /5 ημέρες/);
  assert.match(msg.en, /5 days/);
});

test("έλεγχοι: ηλικία εκτός ορίων ή μη επιτρεπτή", () => {
  assert.deepEqual(codes(crit("2026-10-20T10:00", "2026-10-23T10:00", { age: 19 })), ["AGE"]);
  assert.deepEqual(codes(crit("2026-10-20T10:00", "2026-10-23T10:00", { age: 85 })), ["AGE"]);
  assert.deepEqual(codes(crit("2026-10-20T10:00", "2026-10-23T10:00", { age: 22 })), []);
  const p = validateCriteria(crit("2026-10-20T10:00", "2026-10-23T10:00", { age: 85 }), RULES, NOW)[0];
  assert.equal(p.message.el, "Η ηλικία οδηγού πρέπει να είναι 21–80.");
  assert.equal(p.message.en, "Driver age must be 21–80.");
});

test("έλεγχοι: τοποθεσίες και άκυρες ημερομηνίες", () => {
  assert.deepEqual(codes(crit("2026-10-20T10:00", "2026-10-23T10:00", { pl: null })), ["LOCATION"]);
  assert.deepEqual(codes(crit("2026-10-20T10:00", "2026-10-23T10:00", { pl: "return-only" })), ["LOCATION"]);
  assert.deepEqual(codes(crit("2026-10-20T10:00", "2026-10-23T10:00", { dl: "kissamos" })), []);
  assert.deepEqual(codes(crit("2026-10-20T10:00", "2026-10-23T10:00", { dl: "return-only" })), [], "μόνο-επιστροφή");
  assert.deepEqual(codes(crit("2026-02-30T10:00", "2026-10-23T10:00")), ["INVALID_DATES"]);
  assert.deepEqual(codes(crit("2026-10-20T10:15", "2026-10-23T10:00")), [], "οποιαδήποτε έγκυρη ώρα γίνεται δεκτή");
  assert.deepEqual(validateCriteria(crit("2026-10-20T10:00", "2026-10-23T10:00", { pl: null, dl: null }), { ...RULES, locations: [] }, NOW), [], "χωρίς τοποθεσίες");
});

test("URL: κριτήρια ⇄ query string, άκυρα πεδία πετιούνται", () => {
  const c = { pl: "chania-airport", dl: "kissamos", from: "2026-10-20T10:00", to: "2026-10-23T10:00", age: 25, type: "moto" };
  const q = criteriaToQuery(c);
  assert.equal(q, "pl=chania-airport&dl=kissamos&from=2026-10-20T10%3A00&to=2026-10-23T10%3A00&age=25&type=moto");
  assert.deepEqual(parseCriteria(new URLSearchParams(q)), c);
  assert.deepEqual(parseCriteria({ pl: "../x", dl: "chania-airport", age: "abc", type: "truck", from: "x", to: "y" }), {
    pl: null, dl: "chania-airport", from: "x", to: "y", age: null, type: null,
  });
  assert.equal(parseCriteria({ pl: "a", dl: "a" }).dl, "a", "ίδια επιστροφή ΜΕΝΕΙ (ρητή επιλογή)");
  assert.equal(
    criteriaToQuery({ ...c, dl: "chania-airport", type: null }),
    "pl=chania-airport&dl=chania-airport&from=2026-10-20T10%3A00&to=2026-10-23T10%3A00&age=25",
    "dl στέλνεται ΠΑΝΤΑ, και όταν = pl"
  );
  assert.equal(hasSearch({ from: "2026-10-20T10:00" }), false);
  assert.equal(TIME_SLOTS.length, 48);
  assert.equal(TIME_SLOTS[21], "10:30");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
});

/* ─────────────────────────────────────────────
   Κάρτες: τύποι/καρτέλες, γλώσσα, ιδιωτικά πεδία
   ───────────────────────────────────────────── */

const GROUPS = [
  {
    id: "grp_secret_A", code: "A", vehicleType: "car", name: { el: "Μικρό", en: "Mini" }, similarModels: { el: "Fiat Panda" },
    seats: 4, doors: 5, transmission: "manual", fuel: "PETROL", bagsLarge: 1, bagsSmall: 1, airCondition: true, engineCc: null,
    photoUrl: null, sortOrder: 0,
  },
  {
    id: "grp_secret_M", code: "M125", vehicleType: "moto", name: { fr: "Scooter" }, similarModels: {},
    seats: 2, doors: null, transmission: "automatic", fuel: "PETROL", bagsLarge: 0, bagsSmall: 0, airCondition: false, engineCc: 125,
    photoUrl: "https://res.cloudinary.com/demo/image/upload/v1/m.jpg", sortOrder: 1,
  },
  {
    id: "grp_empty", code: "Q", vehicleType: "atv", name: { el: "ATV" }, similarModels: {},
    seats: 2, doors: null, transmission: "automatic", fuel: "PETROL", bagsLarge: 0, bagsSmall: 0, airCondition: false, engineCc: 300,
    photoUrl: null, sortOrder: 2,
  },
];
const cv = (id, groupId, extra = {}) => ({
  id, tenantId: "tenant_secret", rentalGroupId: groupId, brand: "Fiat", model: "Panda", vehicleType: "car", seats: 4, doors: 5,
  transmission: "Manual", fuel: "PETROL", ac: true, photoUrl: null, status: "AVAILABLE", isActive: true, ...extra,
});
const VEHICLES = [
  cv("veh1", "grp_secret_A", { photoUrl: "https://res.cloudinary.com/demo/image/upload/v1/panda.jpg" }),
  cv("veh2", "grp_secret_A", { status: "MAINTENANCE" }),
  cv("veh3", "grp_secret_M", { vehicleType: "moto" }),
  cv("veh4", "grp_empty", { status: "INACTIVE" }),
  cv("solo", null, { brand: "Jeep", model: "Wrangler", transmission: "Automatic" }),
  cv("hidden", "grp_not_public"),
];

test("κάρτες: μία ανά ομάδα + όχημα χωρίς ομάδα· ομάδα χωρίς ορατά οχήματα κρύβεται", () => {
  const cards = buildCards(GROUPS, VEHICLES, "el");
  assert.deepEqual(cards.map((c) => c.key), ["g.A", "g.M125", "v.solo"]);
  assert.equal(cards[0].photoUrl, "https://res.cloudinary.com/demo/image/upload/v1/panda.jpg", "χωρίς φωτογραφία ομάδας → του οχήματος");
  assert.equal(cards[1].photoUrl, "https://res.cloudinary.com/demo/image/upload/v1/m.jpg", "της ομάδας πρώτα");
  assert.equal(cards[2].photoUrl, null, "χωρίς καμία → placeholder");
  assert.equal(cards[2].specs.transmission, "automatic");
  assert.equal(vehicleCardKey(VEHICLES[5], GROUPS), null, "όχημα κρυφής ομάδας δεν μετρά πουθενά");
  assert.equal(vehicleCardKey(VEHICLES[0], GROUPS), "g.A");
  assert.ok(isCardKey("g.A") && isCardKey("v.solo") && !isCardKey("g.a b") && !isCardKey("x.1"));
});

test("κάρτες: fallback γλώσσας ζητούμενη → en → el → πρώτη", () => {
  const en = buildCards(GROUPS, VEHICLES, "en");
  assert.equal(en[0].name, "Mini");
  assert.equal(en[0].similar, "Fiat Panda", "χωρίς en → el");
  assert.equal(en[1].name, "Scooter", "μόνο fr → η πρώτη");
  assert.equal(en[1].similar, null);
  assert.equal(buildCards(GROUPS, VEHICLES, "el")[0].name, "Μικρό");
  assert.equal(textFor({ el: "Γεια", en: "Hi" }, "fr"), "Hi");
  assert.equal(textFor({ el: "Γεια" }, "en"), "Γεια");
  assert.equal(textFor({ de: "Hallo" }, "en"), "Hallo");
  assert.equal(textFor(null, "el"), "");
});

test("«ή παρόμοιο» δεν διπλασιάζεται όταν είναι ήδη στο κείμενο", () => {
  assert.equal(similarModelName("Fiat Panda ή παρόμοιο"), "Fiat Panda");
  assert.equal(similarModelName("Fiat Panda or similar"), "Fiat Panda");
  assert.equal(similarModelName("Fiat Panda, or Similar."), "Fiat Panda");
  assert.equal(similarModelName("Fiat Panda"), "Fiat Panda");
  const groups = [{ ...GROUPS[0], similarModels: { el: "Fiat Panda ή παρόμοιο", en: "Fiat Panda or similar" } }];
  assert.equal(buildCards(groups, VEHICLES, "el")[0].similar, "Fiat Panda");
  assert.equal(buildCards(groups, VEHICLES, "en")[0].similar, "Fiat Panda");
});

test("καρτέλες: μόνο τύποι με κάρτες, καμία με έναν τύπο· φίλτρο τύπου", () => {
  const cards = buildCards(GROUPS, VEHICLES, "el");
  assert.deepEqual(typeTabs(cards), ["car", "moto"], "το ATV δεν έχει κάρτες → κρύβεται");
  assert.deepEqual(filterByType(cards, "moto").map((c) => c.key), ["g.M125"]);
  assert.equal(filterByType(cards, "atv").length, 3, "κρυμμένη καρτέλα → όλα");
  assert.equal(filterByType(cards, null).length, 3);
  const carsOnly = cards.filter((c) => c.type === "car");
  assert.deepEqual(typeTabs(carsOnly), [], "ένας τύπος → καθόλου καρτέλες");
});

test("ταξινόμηση: φθηνότερη πρώτα / «Τιμή ↓», μη διαθέσιμες πάντα στο τέλος", () => {
  const base = buildCards(GROUPS, VEHICLES, "el");
  const r = (card, total, available, extra = {}) => ({
    ...card, from: null, available, note: null, bookHref: available > 0 ? "/book" : null,
    price: total === null ? null : { days: 3, totalCents: total, listTotalCents: total, avgDailyCents: Math.round(total / 3), badge: null },
    ...extra,
  });
  const cards = [r(base[0], 9000, 0), r(base[1], 12000, 2), r(base[2], 15000, 1)];
  assert.deepEqual(sortCards(cards).map((c) => c.key), ["g.M125", "v.solo", "g.A"]);
  assert.deepEqual(sortCards(cards, "price_desc").map((c) => c.key), ["v.solo", "g.M125", "g.A"]);
});

test("DTO κάρτας: ΚΑΝΕΝΑ ιδιωτικό πεδίο (ids ομάδων, εταιρίας, πινακίδες)", () => {
  const cards = buildCards(GROUPS, VEHICLES, "el");
  for (const c of cards) {
    assert.deepEqual(Object.keys(c).sort(), ["key", "name", "photoUrl", "similar", "sortOrder", "specs", "type"]);
    assert.deepEqual(Object.keys(c.specs).sort(), ["ac", "bagsLarge", "bagsSmall", "doors", "engineCc", "fuel", "seats", "transmission"]);
  }
  const json = JSON.stringify(cards);
  for (const secret of ["grp_secret_A", "grp_secret_M", "tenant_secret", "veh1", "veh2", "veh3", "MAINTENANCE", "status", "tenantId", "rentalGroupId", "plate"]) {
    assert.ok(!json.includes(secret), `διαρροή: ${secret}`);
  }
});

/* ─────────────────────────────────────────────
   Γλώσσα σελίδας / ημερομηνίες
   ───────────────────────────────────────────── */

test("<html lang>: μόνο κωδικός 2 γραμμάτων, αλλιώς el", () => {
  assert.equal(htmlLang("en"), "en");
  assert.equal(htmlLang(null), "el");
  assert.equal(htmlLang("en\" onload=x"), "el");
});

test("ημερομηνίες χωρίς Intl (ίδιες σε server/browser), ΕΛ και EN", () => {
  assert.equal(formatDay("2026-10-16", storefrontDictionary("el")), "Παρ 16 Οκτ");
  assert.equal(formatDay("2026-10-16", storefrontDictionary("en")), "Fri 16 Oct");
  assert.equal(formatDay("2026-10-16", storefrontDictionary("fr")), "Fri 16 Oct", "χωρίς λεξικό → en");
});

test("επιστροφή ΥΠΟΧΡΕΩΤΙΚΗ: χωρίς dl, άγνωστο dl ή dl μόνο-παραλαβής → σφάλμα στο πεδίο dl", () => {
  const RULES2 = { ...RULES, locations: [...RULES.locations, { slug: "pickup-only", allowPickup: true, allowDropoff: false }] };
  const fields = (extra) => validateCriteria(crit("2026-10-20T10:00", "2026-10-23T10:00", extra), RULES2, NOW).map((p) => `${p.code}:${p.field}`);
  assert.deepEqual(fields({ dl: null }), ["LOCATION:dl"], "παλιό URL χωρίς dl");
  assert.deepEqual(fields({ dl: "other-company-loc" }), ["LOCATION:dl"], "τοποθεσία άλλης εταιρίας");
  assert.deepEqual(fields({ dl: "pickup-only" }), ["LOCATION:dl"]);
  assert.deepEqual(fields({ dl: "chania-airport" }), [], "dl = pl δεκτό");
  const msg = validateCriteria(crit("2026-10-20T10:00", "2026-10-23T10:00", { dl: null }), RULES2, NOW)[0].message;
  assert.equal(msg.el, "Διαλέξτε τοποθεσία επιστροφής.");
  assert.equal(msg.en, "Choose a drop-off location.");
  // Μία μόνο τοποθεσία: πάλι υποχρεωτική ρητή επιλογή.
  const one = { ...RULES, locations: [{ slug: "chania-airport", allowPickup: true, allowDropoff: true }] };
  assert.deepEqual(validateCriteria(crit("2026-10-20T10:00", "2026-10-23T10:00", { dl: null }), one, NOW).map((p) => p.field), ["dl"]);
  // Παλιό URL χωρίς dl: parseCriteria δεν σκάει, δίνει κενό → σφάλμα επικύρωσης (όχι 500).
  const old = parseCriteria({ pl: "chania-airport", from: "2026-10-20T10:00", to: "2026-10-23T10:00" });
  assert.equal(old.dl, null);
  assert.deepEqual(validateCriteria(old, RULES, NOW).map((p) => p.field), ["dl"]);
});

test("browser (SearchBox): επιστροφή πάντα ορατή, χωρίς προεπιλογή, στέλνεται ΠΑΝΤΑ, ίδιος έλεγχος", () => {
  const src = readFileSync(new URL("../src/components/storefront/SearchBox.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /otherDropoff/, "κανένας διακόπτης «άλλη τοποθεσία»");
  assert.match(src, /<option value="">\{d\.chooseOption\}<\/option>/, "«Επιλέξτε…» χωρίς προεπιλογή");
  assert.match(src, /dl: dl \|\| null,/, "dl στέλνεται και όταν = pl");
  assert.match(src, /validateCriteria\(c, rules/, "ίδιος έλεγχος με τον server");
  assert.match(src, /scrollIntoView/, "πάει στο πεδίο με το σφάλμα");
  assert.doesNotMatch(src, /disabled=\{[^}]*!dl/, "το κουμπί δεν κλειδώνει από κενά πεδία");
});
