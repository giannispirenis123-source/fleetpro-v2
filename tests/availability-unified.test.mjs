// tests/availability-unified.test.mjs
// ΕΝΑΣ κανόνας διαθεσιμότητας για site, dashboard, walk-in και αλλαγή
// οχήματος στο συμβόλαιο (src/lib/public/availability.ts) · ταυτόχρονη
// κράτηση του ίδιου οχήματος από δύο κανάλια (1 επιτυχία + 1 απόρριψη) ·
// αλλαγή οχήματος σε κατειλημμένο (409) · όριο κρατήσεων ανά IP.
// Χωρίς βάση. Τρέχει με `npm test`.

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

const ROOT = new URL("../", import.meta.url).pathname;
const src = (p) => readFileSync(ROOT + p, "utf8");

const A = await import("../src/lib/public/availability.ts");
const { CONFLICT_STATUSES } = await import("../src/lib/bookings.ts");
const { toConflicts, vehicleConflictsInWindow } = await import("../src/lib/bookingConflicts.ts");
const CV = await import("../src/lib/contractVehicleChange.ts");
const { lockKeyFor } = await import("../src/lib/public/bookingPlan.ts");
const { hitLimit, LIMITS } = await import("../src/lib/public/rateLimit.ts");

const T = "T1";
const bk = (id, vehicleId, status, from, to, extra = {}) => ({
  id,
  bookingNumber: `BP-2026-${id}`,
  tenantId: T,
  vehicleId,
  status,
  pickupDate: from.slice(0, 10),
  pickupTime: from.slice(11, 16) || null,
  returnDate: to.slice(0, 10),
  returnTime: to.slice(11, 16) || null,
  ...extra,
});
const PREP = 60;
const NOW = "2026-07-11T12:00"; // ώρα εταιρίας
const INSTANT = Date.parse("2026-07-11T09:00:00Z");

/* Οι τρεις «ματιές» στον ίδιο κανόνα: */
// site (αναζήτηση/υποβολή): freeVehicleIds στην ομάδα
const siteFree = (bookings, vehicleId, from, to) =>
  A.freeVehicleIds(
    { companyId: T, vehicles: [{ id: vehicleId, tenantId: T, groupKey: "g.A", status: "AVAILABLE", isActive: true }], bookings, from, to, prepMinutes: PREP, now: NOW, instantMs: INSTANT },
    "g.A"
  ).includes(vehicleId);
// dashboard (νέα κράτηση / επεξεργασία): checkVehicleConflicts → blockersOf + toConflicts
const dashFree = (bookings, vehicleId, from, to, excludeBookingId) => {
  const window = { start: A.localMs(from), end: A.localMs(to) };
  const blockers = A.blockersOf(bookings, { companyId: T, vehicleId, window, prepMinutes: PREP, now: NOW, instantMs: INSTANT, excludeBookingId });
  return toConflicts(window, blockers, PREP).length === 0;
};
// walk-in (λίστα οχημάτων): blockedVehicleIds
const walkInFree = (bookings, vehicleId, from, to) =>
  !A.blockedVehicleIds({ companyId: T, vehicles: [], bookings, from, to, prepMinutes: PREP, now: NOW, instantMs: INSTANT }, A.windowOf({ from, to })).has(vehicleId);

const SCENARIOS = [
  ["κενό", [], "v1", "2026-07-20T10:00", "2026-07-22T10:00", true],
  ["επικάλυψη CONFIRMED", [bk("1", "v1", "CONFIRMED", "2026-07-20T10:00", "2026-07-25T10:00")], "v1", "2026-07-22T10:00", "2026-07-24T10:00", false],
  ["PENDING κλείνει", [bk("1", "v1", "PENDING", "2026-07-20T10:00", "2026-07-25T10:00")], "v1", "2026-07-22T10:00", "2026-07-24T10:00", false],
  ["CANCELLED δεν κλείνει", [bk("1", "v1", "CANCELLED", "2026-07-20T10:00", "2026-07-25T10:00")], "v1", "2026-07-22T10:00", "2026-07-24T10:00", true],
  ["COMPLETED δεν κλείνει", [bk("1", "v1", "COMPLETED", "2026-07-20T10:00", "2026-07-25T10:00")], "v1", "2026-07-22T10:00", "2026-07-24T10:00", true],
  ["επιστροφή 10:00 → παραλαβή 10:30 (μέσα στην προετοιμασία 60΄)", [bk("1", "v1", "CONFIRMED", "2026-07-20T10:00", "2026-07-22T10:00")], "v1", "2026-07-22T10:30", "2026-07-24T10:00", false],
  ["επιστροφή 10:00 → παραλαβή 11:00 (μετά την προετοιμασία)", [bk("1", "v1", "CONFIRMED", "2026-07-20T10:00", "2026-07-22T10:00")], "v1", "2026-07-22T11:00", "2026-07-24T10:00", true],
  ["προετοιμασία και πριν από επόμενη", [bk("1", "v1", "CONFIRMED", "2026-07-24T10:30", "2026-07-26T10:00")], "v1", "2026-07-22T10:00", "2026-07-24T10:00", false],
  ["κράτηση χωρίς ώρες = όλη η ημέρα", [bk("1", "v1", "CONFIRMED", "2026-07-20", "2026-07-22")], "v1", "2026-07-22T20:00", "2026-07-24T10:00", false],
  ["καθυστέρηση ACTIVE: κλείνει ως «τώρα»", [bk("1", "v1", "ACTIVE", "2026-07-05T10:00", "2026-07-10T10:00")], "v1", "2026-07-11T12:30", "2026-07-13T10:00", false],
  ["καθυστέρηση ACTIVE: μετά το «τώρα» + προετοιμασία ελεύθερο", [bk("1", "v1", "ACTIVE", "2026-07-05T10:00", "2026-07-10T10:00")], "v1", "2026-07-11T13:30", "2026-07-13T10:00", true],
  ["ληγμένη αναμονή online πληρωμής δεν κλείνει", [bk("1", "v1", "PENDING", "2026-07-20T10:00", "2026-07-25T10:00", { paymentStatus: "AWAITING_PAYMENT", paymentExpiresMs: INSTANT - 1 })], "v1", "2026-07-22T10:00", "2026-07-24T10:00", true],
  ["ενεργή αναμονή online πληρωμής κλείνει", [bk("1", "v1", "PENDING", "2026-07-20T10:00", "2026-07-25T10:00", { paymentStatus: "AWAITING_PAYMENT", paymentExpiresMs: INSTANT + 60_000 })], "v1", "2026-07-22T10:00", "2026-07-24T10:00", false],
  ["άλλη εταιρία δεν κλείνει", [bk("1", "v1", "CONFIRMED", "2026-07-20T10:00", "2026-07-25T10:00", { tenantId: "T2" })], "v1", "2026-07-22T10:00", "2026-07-24T10:00", true],
  ["αλλαγή οχήματος: νέο όχημα κλειστό ΑΠΟ την ημερομηνία αλλαγής", [bk("1", "v1", "CONFIRMED", "2026-07-20T10:00", "2026-07-30T10:00", { vehicleChanges: [{ vehicleId: "v2", date: "2026-07-25" }] })], "v2", "2026-07-26T10:00", "2026-07-28T10:00", false],
  ["αλλαγή οχήματος: νέο όχημα ελεύθερο ΠΡΙΝ την αλλαγή (με προετοιμασία)", [bk("1", "v1", "CONFIRMED", "2026-07-20T10:00", "2026-07-30T10:00", { vehicleChanges: [{ vehicleId: "v2", date: "2026-07-25" }] })], "v2", "2026-07-21T10:00", "2026-07-24T22:00", true],
  ["αλλαγή οχήματος: το αρχικό μένει κλειστό όλο το διάστημα", [bk("1", "v1", "CONFIRMED", "2026-07-20T10:00", "2026-07-30T10:00", { vehicleChanges: [{ vehicleId: "v2", date: "2026-07-25" }] })], "v1", "2026-07-27T10:00", "2026-07-28T10:00", false],
];

test("ΙΔΙΟΣ κανόνας σε site, dashboard και walk-in — σε κάθε σενάριο", () => {
  for (const [name, bookings, vehicleId, from, to, free] of SCENARIOS) {
    assert.equal(siteFree(bookings, vehicleId, from, to), free, `site: ${name}`);
    assert.equal(dashFree(bookings, vehicleId, from, to), free, `dashboard: ${name}`);
    assert.equal(walkInFree(bookings, vehicleId, from, to), free, `walk-in: ${name}`);
  }
});

test("επεξεργασία/επιβεβαίωση: η ίδια κράτηση δεν κλείνει τον εαυτό της", () => {
  const own = [bk("1", "v1", "CONFIRMED", "2026-07-20T10:00", "2026-07-25T10:00")];
  assert.equal(dashFree(own, "v1", "2026-07-21T10:00", "2026-07-26T10:00", "1"), true);
  assert.equal(dashFree(own, "v1", "2026-07-21T10:00", "2026-07-26T10:00"), false);
});

test("OVERLAP vs PREP στα μηνύματα του dashboard (ίδια μορφή με πριν)", () => {
  const b = [bk("7", "v1", "CONFIRMED", "2026-07-20T10:00", "2026-07-22T10:00")];
  const w = (f, t) => ({ start: A.localMs(f), end: A.localMs(t) });
  const c1 = toConflicts(w("2026-07-21T10:00", "2026-07-23T10:00"), A.blockersOf(b, { companyId: T, vehicleId: "v1", window: w("2026-07-21T10:00", "2026-07-23T10:00"), prepMinutes: PREP }), PREP);
  assert.deepEqual(c1.map((c) => [c.bookingNumber, c.kind]), [["BP-2026-7", "OVERLAP"]]);
  const c2 = toConflicts(w("2026-07-22T10:30", "2026-07-23T10:00"), A.blockersOf(b, { companyId: T, vehicleId: "v1", window: w("2026-07-22T10:30", "2026-07-23T10:00"), prepMinutes: PREP }), PREP);
  assert.equal(c2[0].kind, "PREP");
  assert.equal(c2[0].readyAt, "2026-07-22T11:00:00.000Z");
});

test("καταστάσεις που κλείνουν: ίδιες στο dashboard και στο site", () => {
  assert.deepEqual([...CONFLICT_STATUSES], [...A.BLOCKING_STATUSES]);
});

test("κανένα κανάλι δεν κρίνει μόνο του: όλα περνούν από availability.ts", () => {
  const conflicts = src("src/lib/bookingConflicts.ts");
  assert.match(conflicts, /loadBlockingBookings\(client, opts\.tenantId/);
  assert.match(conflicts, /blockersOf\(bookings,/);
  assert.doesNotMatch(conflicts, /findConflicts|booking\.findMany/);
  const walkIn = src("src/lib/walkIn.ts");
  assert.match(walkIn, /loadBlockingBookings\(db, tenantId/);
  assert.match(walkIn, /blockedVehicleIds\(/);
  assert.doesNotMatch(walkIn, /findConflicts|booking\.findMany/);
  assert.match(src("src/lib/bookingDecision.ts"), /freeVehicleIds\(/);
  assert.match(src("src/lib/public/bookingPlan.ts"), /freeVehicleIds\(availability, req\.key\)/);
  // Νέα κράτηση/επεξεργασία dashboard και walk-in: checkVehicleConflicts (ίδιος κανόνας).
  assert.match(src("src/lib/bookingCreate.ts"), /checkVehicleConflicts\(\{\s*client: tx,/);
  assert.match(src("src/app/api/bookings/[id]/route.ts"), /checkVehicleConflicts\(\{ \.\.\.recheck, client: tx \}\)/);
  // Κανένας άλλος κώδικας δεν χρησιμοποιεί τον παλιό χωριστό έλεγχο.
  for (const f of ["src/lib/bookingCreate.ts", "src/lib/walkIn.ts", "src/lib/bookingConflicts.ts", "src/app/api/contracts/[id]/route.ts", "src/lib/contractVehicleChange.ts"]) {
    assert.doesNotMatch(src(f), /findConflicts\(/, f);
  }
});

/* ─────────────────────────────────────────────
   Ταυτόχρονη κράτηση ίδιου οχήματος από δύο κανάλια
   ───────────────────────────────────────────── */

/** Μνήμη + κλείδωμα ανά κλειδί, όπως το pg_advisory_xact_lock. */
function fakeDb() {
  const bookings = [];
  const queues = new Map();
  const withLock = async (key, fn) => {
    const prev = queues.get(key) ?? Promise.resolve();
    let release;
    const next = new Promise((r) => (release = r));
    queues.set(key, prev.then(() => next));
    await prev;
    try {
      // Λίγη αναμονή μέσα στο κλείδωμα: χωρίς κλείδωμα θα περνούσαν και οι δύο.
      await new Promise((r) => setTimeout(r, 5));
      return await fn();
    } finally {
      release();
    }
  };
  return { bookings, withLock };
}

/** Ένα κανάλι = έλεγχος με τον ΚΟΙΝΟ κανόνα ΜΕΣΑ στο ΚΟΙΝΟ κλείδωμα, μετά εγγραφή. */
const channel = (db, name) => (vehicleId, from, to) =>
  db.withLock(lockKeyFor(T), async () => {
    if (!dashFree([...db.bookings], vehicleId, from, to)) return { ok: false, status: 409, channel: name };
    db.bookings.push(bk(String(db.bookings.length + 1), vehicleId, name === "site" ? "PENDING" : "CONFIRMED", from, to));
    return { ok: true, channel: name };
  });

test("ταυτόχρονα site + dashboard για το ίδιο όχημα/διάστημα → 1 επιτυχία + 1 καθαρή απόρριψη", async () => {
  for (let i = 0; i < 20; i++) {
    const db = fakeDb();
    const results = await Promise.all([
      channel(db, "site")("v1", "2026-08-01T10:00", "2026-08-05T10:00"),
      channel(db, "dashboard")("v1", "2026-08-02T10:00", "2026-08-03T10:00"),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1, `γύρος ${i}`);
    assert.deepEqual(results.filter((r) => !r.ok).map((r) => r.status), [409]);
    assert.equal(db.bookings.length, 1);
  }
});

test("ΙΔΙΟ κλείδωμα εταιρίας σε όλα τα κανάλια που γράφουν (site, dashboard, walk-in, επιβεβαίωση, συμβόλαιο)", () => {
  assert.equal(lockKeyFor("X"), "site-booking:X");
  assert.match(src("src/lib/public/bookingPlan.ts"), /store\.withLock\(lockKeyFor\(cat\.companyId\)/);
  assert.match(src("src/lib/bookingCreate.ts"), /pg_advisory_xact_lock\(hashtext\(\$\{lockKeyFor\(plan\.tenantId\)\}\)\)/);
  assert.match(src("src/lib/bookingDecisionServer.ts"), /pg_advisory_xact_lock\(hashtext\(\$\{lockKeyFor\(tenantId\)\}\)\)/);
  assert.match(src("src/app/api/contracts/walk-in/route.ts"), /writeBooking\(tx, plan, customerId\)/);
  const contract = src("src/app/api/contracts/[id]/route.ts");
  assert.match(contract, /pg_advisory_xact_lock\(hashtext\(\$\{lockKeyFor\(tenantId\)\}\)\)`;\s*await assertVehicleChangesFree\(tx,/);
});

/* ─────────────────────────────────────────────
   Αλλαγή οχήματος στο συμβόλαιο
   ───────────────────────────────────────────── */

test("αλλαγή οχήματος: ελέγχονται ΜΟΝΟ οι νέες αλλαγές", () => {
  const prev = [{ id: "c1", vehicleId: "v2", date: "2026-07-25", label: "x", plate: "y" }];
  assert.deepEqual(CV.addedVehicleChanges(prev, [{ vehicleId: "v2", date: "2026-07-25" }]), []);
  assert.deepEqual(CV.addedVehicleChanges(prev, [{ vehicleId: "v2", date: "2026-07-25" }, { vehicleId: "v3", date: "2026-07-26" }]), [{ vehicleId: "v3", date: "2026-07-26" }]);
  assert.deepEqual(CV.addedVehicleChanges(null, [{ vehicleId: "v2", date: "2026-07-26" }]), [{ vehicleId: "v2", date: "2026-07-26" }]);
  const own = { start: A.localMs("2026-07-20T10:00"), end: A.localMs("2026-07-30T10:00") };
  assert.deepEqual(A.changeInterval("2026-07-25", own), { start: A.localMs("2026-07-25T00:00"), end: own.end });
  assert.deepEqual(A.changeInterval("2026-07-01", own), own, "πριν την παραλαβή → από την παραλαβή");
});

/** Ψεύτικο tx: κρατήσεις της βάσης + εταιρία. */
function fakeTx(rows) {
  return {
    booking: {
      findMany: async ({ where }) => rows.filter((r) => r.tenantId === where.tenantId),
      findFirst: async ({ where }) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null,
    },
    tenant: { findUnique: async () => ({ prepTimeMinutes: 60, storefrontSettings: {} }) },
  };
}
const row = (id, vehicleId, status, from, to, extra = {}) => ({
  id,
  bookingNumber: `BP-2026-${id}`,
  tenantId: T,
  vehicleId,
  status,
  pickupDate: new Date(`${from.slice(0, 10)}T00:00:00.000Z`),
  pickupTime: from.slice(11, 16),
  returnDate: new Date(`${to.slice(0, 10)}T00:00:00.000Z`),
  returnTime: to.slice(11, 16),
  paymentStatus: "NONE",
  paymentExpiresAt: null,
  contract: null,
  ...extra,
});

test("αλλαγή οχήματος σε ΚΑΤΕΙΛΗΜΜΕΝΟ όχημα → σφάλμα με σαφές ελληνικό μήνυμα", async () => {
  const tx = fakeTx([
    row("own", "v1", "ACTIVE", "2026-07-20T10:00", "2026-07-30T10:00"),
    row("9", "v2", "CONFIRMED", "2026-07-26T10:00", "2026-07-28T10:00"),
  ]);
  const now = new Date("2026-07-21T08:00:00Z");
  await assert.rejects(
    CV.assertVehicleChangesFree(tx, { tenantId: T, bookingId: "own", changes: [{ vehicleId: "v2", date: "2026-07-25" }], labels: new Map([["v2", "Fiat Panda (ΧΝΑ-1234)"]]), now }),
    (e) => e instanceof CV.VehicleChangeConflictError &&
      e.message === "Το όχημα Fiat Panda (ΧΝΑ-1234) δεν είναι ελεύθερο από 25/07/2026 ως την επιστροφή: συγκρούεται με την κράτηση BP-2026-9. Δεν αποθηκεύτηκε καμία αλλαγή."
  );
  // Ελεύθερο όχημα → περνά. Η ίδια η κράτηση δεν μετρά.
  await CV.assertVehicleChangesFree(tx, { tenantId: T, bookingId: "own", changes: [{ vehicleId: "v3", date: "2026-07-25" }], labels: new Map(), now });
  await CV.assertVehicleChangesFree(tx, { tenantId: T, bookingId: "own", changes: [{ vehicleId: "v1", date: "2026-07-25" }], labels: new Map(), now });
  // Το v2 είναι κλεισμένο μόνο 26–28/7: αλλαγή που ξεκινά μετά (29/7) περνά.
  await CV.assertVehicleChangesFree(tx, { tenantId: T, bookingId: "own", changes: [{ vehicleId: "v2", date: "2026-07-29" }], labels: new Map(), now });
});

test("αλλαγή οχήματος: κράτηση ΑΛΛΗΣ εταιρίας δεν μετρά (ερωτήματα με tenantId)", async () => {
  const tx = fakeTx([
    row("own", "v1", "ACTIVE", "2026-07-20T10:00", "2026-07-30T10:00"),
    row("x", "v2", "CONFIRMED", "2026-07-26T10:00", "2026-07-28T10:00", { tenantId: "T2" }),
  ]);
  await CV.assertVehicleChangesFree(tx, { tenantId: T, bookingId: "own", changes: [{ vehicleId: "v2", date: "2026-07-25" }], labels: new Map(), now: new Date("2026-07-21T08:00:00Z") });
  // Κράτηση άλλης εταιρίας ως «δική μας»: δεν βρίσκεται → τίποτα.
  await CV.assertVehicleChangesFree(tx, { tenantId: "T2", bookingId: "own", changes: [{ vehicleId: "v9", date: "2026-07-25" }], labels: new Map() });
  const c = await vehicleConflictsInWindow({ client: tx, tenantId: T, vehicleId: "v2", window: { start: A.localMs("2026-07-26T10:00"), end: A.localMs("2026-07-27T10:00") }, prepMinutes: 0 });
  assert.deepEqual(c, []);
});

test("συμβόλαιο: 409, τίποτα δεν αποθηκεύεται, ρόλοι/εταιρία όπως πριν", () => {
  const r = src("src/app/api/contracts/[id]/route.ts");
  assert.match(r, /if \(error instanceof VehicleChangeConflictError\) return conflict\(error\.message\);/);
  // Ο έλεγχος είναι ΠΡΩΤΟΣ μέσα στην transaction: σε σύγκρουση rollback όλων.
  assert.match(r, /await db\.\$transaction\(async \(tx\) => \{\s*if \(addedChanges\.length > 0\) \{/);
  assert.match(r, /where: \{ \.\.\.contractScope\(viewer!\), id: params!\.id \}/);
  assert.match(r, /"contracts\.edit"\s*\);/);
  assert.match(src("src/lib/contractVehicleChange.ts"), /where: \{ id: opts\.bookingId, tenantId: opts\.tenantId \}/);
  assert.match(src("src/lib/contractForm.ts"), /where: \{ tenantId, id: \{ in: changes\.map\(\(c\) => c\.vehicleId\) \} \}/);
});

/* ─────────────────────────────────────────────
   Όριο κρατήσεων ανά IP
   ───────────────────────────────────────────── */

test("όριο ανά IP: 10 περνούν, η 11η κλειδώνει· άλλο IP / νέα ώρα περνά", async () => {
  assert.deepEqual(LIMITS.bookingPerClient, { scope: "book-ip", max: 10, windowMinutes: 60 });
  const counts = new Map();
  const store = { increment: async (key, ws) => { const k = `${key}@${ws.toISOString()}`; counts.set(k, (counts.get(k) ?? 0) + 1); return counts.get(k); } };
  const now = new Date("2026-07-11T09:10:00Z");
  const res = [];
  for (let i = 0; i < 11; i++) res.push(await hitLimit(store, LIMITS.bookingPerClient, "203.0.113.5", now));
  assert.deepEqual(res, [...Array(10).fill(true), false]);
  assert.equal(await hitLimit(store, LIMITS.bookingPerClient, "198.51.100.7", now), true, "άλλο IP");
  assert.equal(await hitLimit(store, LIMITS.bookingPerClient, "203.0.113.5", new Date("2026-07-11T10:00:00Z")), true, "νέα ώρα");
  // Το ευρύτερο όριο ανά εταιρία μένει.
  assert.equal(LIMITS.bookingPerTenant.max, 30);
  assert.ok(![...counts.keys()].some((k) => k.includes("203.0.113.5")), "μόνο hash, ποτέ IP");
});

test("όριο ανά IP: στον server, μετά τους ελέγχους, ίδια απάντηση 429 με τα άλλα όρια", () => {
  const sub = src("src/lib/public/bookingSubmit.ts");
  assert.match(sub, /const okClient = await hitLimit\(dbCounterStore, LIMITS\.bookingPerClient, clientIp, now\);/);
  assert.match(sub, /if \(!okClient \|\| !okEmail \|\| !okTenant \|\| !okCheckout\) \{\s*return \{ ok: false, status: 429, message: msg\("Πολλές υποβολές/);
  const route = src("src/app/api/public/booking/route.ts");
  assert.match(route, /const ip = \(req\.headers\.get\("x-forwarded-for"\) \?\? ""\)\.split\(","\)\[0\]\.trim\(\) \|\| "unknown";/);
  assert.match(route, /submitPublicBooking\(body, new Date\(\), publicOrigin\(req\), ip\)/);
  // Ίδιος τρόπος IP με το όριο της τιμής.
  assert.match(src("src/app/api/public/quote/route.ts"), /const ip = \(req\.headers\.get\("x-forwarded-for"\) \?\? ""\)\.split\(","\)\[0\]\.trim\(\) \|\| "unknown";/);
});
