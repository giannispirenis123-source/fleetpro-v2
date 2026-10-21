// tests/audit-close.test.mjs
// Κλείσιμο του audit 10/2026: μάσκα ΑΔΤ/διπλώματος στη σελίδα πελάτη (στον
// server), κλείδωμα σύνδεσης μετά από 10 λάθη (προσωρινό, ίδια απάντηση για
// άγνωστο χρήστη), επανάληψη σε σύγκρουση αριθμού κράτησης (SQL 30), αφαίρεση
// jspdf. Καθαρή λογική + ψεύτικο store + στατικοί έλεγχοι — χωρίς βάση.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const L = await import("../src/lib/contractLink.ts");
const K = await import("../src/lib/loginLock.ts");
const R = await import("../src/lib/bookingNumberRetry.ts");

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* ── Μάσκα στη σελίδα πελάτη ── */

test("μάσκα: μόνο τα 4 τελευταία, ποτέ ολόκληρος αριθμός", () => {
  assert.equal(L.maskDocNumber("AK 123456"), "••••3456");
  assert.equal(L.maskDocNumber("Χ-998877"), "••••8877");
  assert.equal(L.maskDocNumber("123456789012"), "••••9012");
  // Μέχρι 4 χαρακτήρες: ούτε αυτοί φαίνονται.
  assert.equal(L.maskDocNumber("1234"), "••••");
  assert.equal(L.maskDocNumber("AB1"), "••••");
  assert.equal(L.maskDocNumber(""), "");
  assert.equal(L.maskDocNumber(null), "");
});

const driver = (over = {}) => ({
  id: "drv_secret_1",
  fullName: "Test Driver",
  country: "GR",
  licenseNumber: "DL-55667788",
  licenseExpiry: "2030-01-01",
  birthDate: "1990-01-01",
  idType: "ID",
  idNumber: "AK123456",
  phone: "",
  email: "",
  address: "",
  signature: null,
  signedAt: null,
  ...over,
});

const contract = (drivers) => ({
  id: "k1",
  contractNumber: "C-ABC123",
  status: "SIGNED",
  bookingId: "b1",
  bookingNumber: "BP-2026-001",
  bookingStatus: "ACTIVE",
  createdByName: "Staff",
  snapshot: null,
  drivers,
  pickupLocation: "",
  returnLocation: "",
  fuelType: null,
  fuelPickup: null,
  fuelReturn: null,
  damageMarks: [],
  damagePhotos: [],
  damageNotesPickup: "",
  damageNotesReturn: "",
  vehicleChanges: [],
  notes: "",
  paymentMethod: null,
  depositAmount: null,
  depositMethod: null,
  paymentCard: null,
  depositCard: null,
  cardNumberSaved: { payment: false, deposit: false },
  gdprConsent: true,
  signedAt: null,
  completedAt: null,
  createdAt: "",
  updatedAt: "",
  bookingExtraIds: [],
  bookingTotalNow: 0,
  extrasLock: null,
  licensePhotos: [],
  publicLink: { state: "active", token: "t", expiresAt: null },
});

test("σελίδα πελάτη: ο server στέλνει ΜΟΝΟ μασκαρισμένους αριθμούς ΑΔΤ/διαβατηρίου/διπλώματος", () => {
  const pub = L.toPublicContract(contract([driver(), driver({ id: "d2", idType: "PASSPORT", idNumber: "P9876543", licenseNumber: "778899" })]));
  assert.equal(pub.drivers[0].idNumber, "••••3456");
  assert.equal(pub.drivers[0].licenseNumber, "••••7788");
  assert.equal(pub.drivers[1].idNumber, "••••6543");
  assert.equal(pub.drivers[1].licenseNumber, "••••8899");
  const json = JSON.stringify(pub);
  for (const full of ["AK123456", "55667788", "P9876543", "778899"]) assert.ok(!json.includes(full), `διαρρέει ${full}`);
  // Η σελίδα παίρνει ΜΟΝΟ το toPublicContract.
  assert.match(read("src/lib/contractForm.ts"), /contract: toPublicContract\(\{/);
});

test("dashboard: ο υπάλληλος βλέπει τον πλήρη αριθμό (το DTO δεν μασκάρεται)", () => {
  const src = read("src/lib/contractForm.ts");
  const dto = src.slice(src.indexOf("export function toContractDTO"), src.indexOf("export async function loadContract("));
  assert.ok(dto.length > 0);
  assert.doesNotMatch(dto, /maskDocNumber/);
});

/* ── Κλείδωμα σύνδεσης ── */

function fakeStore() {
  const fails = new Map(); // key → [Date]
  const locks = new Map(); // key → Date
  return {
    fails,
    locks,
    addFailure: async (k, now) => fails.set(k, [...(fails.get(k) ?? []), now]),
    failuresSince: async (k, since) => (fails.get(k) ?? []).filter((d) => d >= since).length,
    lockedUntil: async (k, now) => {
      const u = locks.get(k);
      return u && u > now ? u : null;
    },
    lock: async (k, until) => locks.set(k, until),
    clearFailures: async (k) => fails.delete(k),
  };
}

const T0 = new Date("2026-10-20T10:00:00Z");
const at = (min) => new Date(T0.getTime() + min * 60_000);

test("κλείδωμα: 9 λάθη → όχι· το 10ο κλειδώνει για 15΄· μετά τη λήξη ξανά πρόσβαση", async () => {
  const s = fakeStore();
  for (let i = 0; i < 9; i++) {
    const r = await K.recordLoginFailure(s, "admin@prentals.gr", "1.1.1.1", at(i * 0.5));
    assert.equal(r.lockedNow, false);
  }
  assert.equal(await K.isLoginLocked(s, "admin@prentals.gr", "1.1.1.1", at(5)), false);
  const tenth = await K.recordLoginFailure(s, "ADMIN@prentals.gr ", "1.1.1.1", at(5));
  assert.equal(tenth.lockedNow, true, "το 10ο λάθος κλειδώνει (email χωρίς διάκριση κεφαλαίων)");
  // Κλειδωμένο ακόμα και για τον σωστό κωδικό (ο έλεγχος γίνεται ΠΡΙΝ τον κωδικό).
  assert.equal(await K.isLoginLocked(s, "admin@prentals.gr", "1.1.1.1", at(6)), true);
  assert.equal(await K.isLoginLocked(s, "admin@prentals.gr", "1.1.1.1", at(19.9)), true);
  // Προσωρινό: μετά από 15΄ ξεκλειδώνει, με νέα δεκάδα λαθών.
  assert.equal(await K.isLoginLocked(s, "admin@prentals.gr", "1.1.1.1", at(20.1)), false);
  assert.equal((await K.recordLoginFailure(s, "admin@prentals.gr", "1.1.1.1", at(21))).lockedNow, false);
});

test("κλείδωμα: λάθη παλαιότερα από 15΄ δεν μετρούν (κυλιόμενο παράθυρο)", async () => {
  const s = fakeStore();
  for (let i = 0; i < 9; i++) await K.recordLoginFailure(s, "a@b.gr", "2.2.2.2", at(i));
  // 20΄ αργότερα: τα παλιά 9 έχουν βγει από το παράθυρο.
  assert.equal((await K.recordLoginFailure(s, "a@b.gr", "2.2.2.2", at(30))).lockedNow, false);
});

test("κλείδωμα: ίδια συμπεριφορά για άγνωστο email (δεν μαρτυρά αν υπάρχει ο χρήστης)", async () => {
  const known = fakeStore();
  const unknown = fakeStore();
  const run = async (s, email) => {
    const out = [];
    for (let i = 0; i < 11; i++) {
      out.push(await K.isLoginLocked(s, email, "3.3.3.3", at(i)));
      out.push((await K.recordLoginFailure(s, email, "3.3.3.3", at(i))).lockedNow);
    }
    return out;
  };
  assert.deepEqual(await run(known, "staff@prentals.gr"), await run(unknown, "nobody-here@example.com"));
  // Το route δίνει το ΙΔΙΟ 429 και το ίδιο μήνυμα, πριν καν διαβάσει τον χρήστη.
  const route = read("src/app/api/auth/login/route.ts");
  const lockCheck = route.indexOf("isLoginLocked(");
  assert.ok(lockCheck > 0 && lockCheck < route.indexOf("db.user.findUnique"), "έλεγχος κλειδώματος πριν την αναζήτηση χρήστη");
  assert.match(route, /isLoginLocked\(dbLoginLockStore, email, ip\)\)\) \{\s*return NextResponse\.json\(\{ success: false, message: LOGIN_MSG\.tooMany \}, \{ status: 429 \}\)/);
});

test("κλείδωμα: δεν μπλοκάρει τον Διαχειριστή από άλλη IP· σωστό login μηδενίζει τα λάθη", async () => {
  const s = fakeStore();
  for (let i = 0; i < 10; i++) await K.recordLoginFailure(s, "admin@prentals.gr", "6.6.6.6", at(i * 0.1));
  assert.equal(await K.isLoginLocked(s, "admin@prentals.gr", "6.6.6.6", at(2)), true, "ο επιτιθέμενος κλειδώνεται");
  assert.equal(await K.isLoginLocked(s, "admin@prentals.gr", "7.7.7.7", at(2)), false, "ο Διαχειριστής από άλλη IP μπαίνει");
  // Σωστό login → μηδέν λάθη (ξανά 10 μέχρι κλείδωμα).
  for (let i = 0; i < 9; i++) await K.recordLoginFailure(s, "admin@prentals.gr", "7.7.7.7", at(3));
  await K.clearLoginFailures(s, "admin@prentals.gr", "7.7.7.7");
  assert.equal((await K.recordLoginFailure(s, "admin@prentals.gr", "7.7.7.7", at(4))).failures, 1);
});

test("κλείδωμα: επίθεση από πολλές IP → προσωρινό κλείδωμα του email μετά από 100 λάθη/ώρα", async () => {
  const s = fakeStore();
  let locked = false;
  for (let i = 0; i < K.LOGIN_LOCK.emailMaxFailures; i++) {
    locked = (await K.recordLoginFailure(s, "admin@prentals.gr", `10.0.${Math.floor(i / 9)}.${i % 9}`, at(i * 0.3))).lockedNow || locked;
  }
  assert.equal(locked, true);
  assert.equal(await K.isLoginLocked(s, "admin@prentals.gr", "99.99.99.99", at(31)), true);
  assert.equal(await K.isLoginLocked(s, "admin@prentals.gr", "99.99.99.99", at(30 + 16)), false, "προσωρινό");
});

test("κλείδωμα: ένδειξη στο activity log μία φορά, χωρίς IP/κωδικό· κλειδιά πάντα hash", () => {
  const route = read("src/app/api/auth/login/route.ts");
  assert.match(route, /if \(lockedNow && user\) \{\s*await db\.activityLog\.create\(/);
  assert.match(route, /action: "auth\.login_locked"/);
  const log = route.slice(route.indexOf('action: "auth.login_locked"'), route.indexOf("const decision"));
  assert.doesNotMatch(log, /\bip\b|password|email/);
  for (const k of [K.pairFailKey("a@b.gr", "1.2.3.4"), K.pairLockKey("a@b.gr", "1.2.3.4"), K.emailFailKey("a@b.gr"), K.emailLockKey("a@b.gr")]) {
    assert.doesNotMatch(k, /a@b\.gr|1\.2\.3\.4/);
  }
  assert.equal(K.LOGIN_LOCK.maxFailures, 10);
  assert.equal(K.LOGIN_LOCK.lockMinutes, 15);
});

/* ── Σύγκρουση αριθμού κράτησης ── */

const conflict = (target) => Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target } });

test("αριθμός κράτησης: αναγνωρίζεται η σύγκρουση στο UNIQUE (πεδία ή όνομα index)", () => {
  assert.equal(R.isBookingNumberConflict(conflict(["tenantId", "bookingNumber"])), true);
  assert.equal(R.isBookingNumberConflict(conflict("bookings_tenantId_bookingNumber_key")), true);
  assert.equal(R.isBookingNumberConflict(conflict(["publicCode"])), false);
  assert.equal(R.isBookingNumberConflict(new Error("x")), false);
  assert.equal(R.isBookingNumberConflict(null), false);
});

test("αριθμός κράτησης: σύγκρουση → η transaction ξανατρέχει (όχι 500)· άλλο σφάλμα δεν ξανατρέχει", async () => {
  let calls = 0;
  const ok = await R.withBookingNumberRetry(async () => {
    calls++;
    if (calls === 1) throw conflict(["tenantId", "bookingNumber"]);
    return "BP-2026-014";
  });
  assert.equal(ok, "BP-2026-014");
  assert.equal(calls, 2);

  let other = 0;
  await assert.rejects(R.withBookingNumberRetry(async () => { other++; throw new Error("boom"); }), /boom/);
  assert.equal(other, 1);

  let always = 0;
  await assert.rejects(R.withBookingNumberRetry(async () => { always++; throw conflict(["tenantId", "bookingNumber"]); }), (e) => e.code === "P2002");
  assert.equal(always, R.BOOKING_NUMBER_ATTEMPTS);
});

test("αριθμός κράτησης: site, dashboard και walk-in τυλίγουν ΟΛΗ τη transaction στην επανάληψη", () => {
  assert.match(read("src/app/api/bookings/route.ts"), /withBookingNumberRetry\(\(\) =>\s*db\.\$transaction\(\(tx\) => writeBooking\(/);
  assert.match(read("src/app/api/contracts/walk-in/route.ts"), /withBookingNumberRetry\(\(\) => db\.\$transaction\(/);
  assert.match(read("src/lib/public/bookingSubmit.ts"), /withBookingNumberRetry\(\(\) => runSiteBooking\(/);
});

test("SQL 30: UNIQUE μόνο χωρίς διπλότυπα (NOTICE, όχι αποτυχία), idempotent, indexes ίδια με το schema", () => {
  const sql = read("prisma/sql/30-booking-number-unique.sql");
  assert.match(sql, /IF dupes > 0 THEN\s*RAISE NOTICE/);
  assert.doesNotMatch(sql, /RAISE EXCEPTION|DELETE|UPDATE "bookings"|DROP/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "bookings_tenantId_bookingNumber_key"/);
  assert.equal((sql.match(/CREATE INDEX IF NOT EXISTS/g) ?? []).length, 6);
  assert.match(sql, /Επαλήθευση \(αναμενόμενο: 0 \| 1 \| 6\)/);
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /@@unique\(\[tenantId, bookingNumber\]\)/);
});

/* ── jspdf ── */

test("jspdf: αφαιρέθηκε (κανένα import, κανένα πακέτο) — τα PDF είναι pdf-lib", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies.jspdf, undefined);
  assert.equal(pkg.dependencies["jspdf-autotable"], undefined);
  assert.ok(pkg.dependencies["pdf-lib"]);
  const walk = (d) =>
    readdirSync(new URL(`../${d}`, import.meta.url)).flatMap((n) => {
      const p = `${d}/${n}`;
      return statSync(new URL(`../${p}`, import.meta.url)).isDirectory() ? walk(p) : [p];
    });
  const users = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && /jspdf/i.test(read(f)));
  assert.deepEqual(users, []);
});
