// tests/partner-finance.test.mjs — συνεργάτης: «Οικονομικά» (μόνο οι δικές του
// κρατήσεις, σύνολα χωρίς ακυρωμένες/επιστραμμένες, υπάρχουσα προμήθεια),
// δικαιώματα «διαθεσιμότητα» / «κράτηση» (προεπιλογή όχι, κράτηση ⇒ διαθεσιμότητα,
// 403 χωρίς δικαίωμα), διαθεσιμότητα χωρίς στοιχεία κρατήσεων.

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

const P = await import("../src/lib/permissions.ts");
const F = await import("../src/lib/partnerFinance.ts");
const A = await import("../src/lib/partnerAvailability.ts");
const C = await import("../src/lib/commission.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* ── Δικαιώματα ── */

test("προεπιλογές: «διαθεσιμότητα» και «κράτηση» ΑΤΙΚΑΡΙΣΤΑ για νέους και υπάρχοντες συνεργάτες", () => {
  const d = P.defaultsForRole("PARTNER");
  assert.equal(d["partner.availability"], undefined);
  assert.equal(d["partner.book"], undefined);
  assert.equal(P.can("PARTNER", d, "partner.availability"), false);
  assert.equal(P.can("PARTNER", d, "partner.book"), false);
  // Υπάρχων συνεργάτης (JSON χωρίς τα νέα κλειδιά): καμία αλλαγή.
  const existing = P.normalizePermissions({ "dashboard.view": true, "bookings.view": true, "commission.view": true });
  assert.equal(P.can("PARTNER", existing, "partner.availability"), false);
  assert.equal(P.can("PARTNER", existing, "bookings.view"), true);
  // Η φόρμα ξεκινά ατικάριστη.
  const ui = read("src/app/(dashboard)/dashboard/users/UsersClient.tsx");
  assert.match(ui, /partnerAvailability: false,\s+partnerBook: false,/);
});

test("«κράτηση» ⇒ «διαθεσιμότητα»: στον server (αποθήκευση/ανάγνωση) και στο UI", () => {
  assert.deepEqual(P.permissionsFromKeys(["partner.book"]), { "partner.book": true, "partner.availability": true });
  assert.deepEqual(P.normalizePermissions({ "partner.book": true }), { "partner.book": true, "partner.availability": true });
  assert.deepEqual(P.togglePermission({}, "partner.book", true), { "partner.book": true, "partner.availability": true });
  // Χωρίς διαθεσιμότητα φεύγει και η κράτηση.
  assert.deepEqual(P.togglePermission({ "partner.book": true, "partner.availability": true }, "partner.availability", false), {});
  assert.deepEqual(P.togglePermission({ "partner.book": true, "partner.availability": true }, "partner.book", false), { "partner.availability": true });
  const ui = read("src/app/(dashboard)/dashboard/users/UsersClient.tsx");
  assert.match(ui, /set\(e\.target\.checked \? \{ partnerBook: true, partnerAvailability: true \} : \{ partnerBook: false \}\)/);
});

test("ο συνεργάτης ΔΕΝ βλέπει ποτέ οικονομικά/ρυθμίσεις/χρήστες/αναφορές της εταιρίας", () => {
  const all = P.permissionsFromKeys(P.ALL_PERMISSIONS);
  for (const k of ["finance.view", "finance.create", "settings.view", "settings.edit", "users.view", "users.permissions", "reports.view"]) {
    assert.equal(P.can("PARTNER", all, k), false, k);
    assert.equal(P.can("STAFF", all, k), true, `${k} (προσωπικό: όπως πριν)`);
  }
  assert.equal(P.can("COMPANY_ADMIN", {}, "finance.view"), true);
  // Η ενότητα «Συνεργάτης» φαίνεται μόνο σε συνεργάτη· οι απαγορευμένες όχι σε συνεργάτη.
  const ids = (role) => P.groupsForRole(role).map((g) => g.id);
  assert.ok(ids("PARTNER").includes("partner") && !ids("PARTNER").includes("finance"));
  assert.ok(!ids("STAFF").includes("partner") && ids("STAFF").includes("finance"));
});

test("403 χωρίς δικαίωμα: κάθε endpoint με φύλακα στον server + μόνο ρόλος συνεργάτη", () => {
  const routes = {
    "src/app/api/partner/finance/route.ts": '"commission.view"',
    "src/app/api/partner/availability/route.ts": '"partner.availability"',
    "src/app/api/partner/bookings/route.ts": '"partner.book"',
  };
  for (const [f, key] of Object.entries(routes)) {
    const s = read(f);
    assert.match(s, /export const (GET|POST) = withPermission\(/, f);
    assert.ok(s.trimEnd().endsWith(`${key}\n);`), `${f}: δικαίωμα ${key}`);
    assert.match(s, /if \(!isPartnerViewer\(viewer\)\) return forbidden\("Μόνο για συνεργάτες"\);/, f);
  }
  // Ο φύλακας επιστρέφει 403 όταν λείπει το δικαίωμα.
  assert.match(read("src/lib/authz.ts"), /if \(required\.some\(\(k\) => !viewerCan\(viewer, k\)\)\) \{\s+return forbidden\(/);
  // Σελίδες: ίδιο κλειδί + μόνο συνεργάτης.
  assert.match(read("src/app/(dashboard)/dashboard/partner/finance/page.tsx"), /pageGuard\("commission\.view"\);\s+if \(!guard \|\| !isPartner\(guard\.viewer\)\) redirect/);
  assert.match(read("src/app/(dashboard)/dashboard/partner/availability/page.tsx"), /pageGuard\("partner\.availability"\);\s+if \(!guard \|\| !isPartner\(guard\.viewer\)\) redirect/);
});

/* ── Οικονομικά ── */

const S10 = { rate: 10, onRental: true, onExtras: false, onInsurance: false };
const row = (id, status, totalCents, subtotal, extra = {}) => ({
  id, bookingNumber: `BP-${id}`, pickupDate: "2026-11-05", returnDate: "2026-11-07", customer: "Μαρία Παπαδάκη",
  status, paymentStatus: "NONE", totalCents, subtotal, extrasTotal: 20, insuranceCost: 10, ...extra,
});

test("σύνολα: μετράνε PENDING/CONFIRMED/ACTIVE/COMPLETED· όχι ακυρωμένες ούτε με πλήρη επιστροφή", () => {
  const r = F.partnerFinance(
    [
      row("1", "COMPLETED", 18000, 150),
      row("2", "CONFIRMED", 12050, 100),
      row("3", "PENDING", 5000, 40),
      row("4", "ACTIVE", 7000, 60),
      row("5", "CANCELLED", 99900, 900),
      row("6", "COMPLETED", 30000, 250, { paymentStatus: "REFUNDED" }),
      row("7", "COMPLETED", 10000, 80, { paymentStatus: "PARTIALLY_REFUNDED" }),
    ],
    S10
  );
  assert.equal(r.totals.bookings, 5);
  assert.equal(r.totals.totalCents, 18000 + 12050 + 5000 + 7000 + 10000);
  // Προμήθεια = commissionFor (10% μόνο επί ενοικίου): 15 + 10 + 4 + 6 + 8 = 43 €.
  assert.equal(r.totals.commissionCents, 4300);
  const cancelled = r.items.find((i) => i.id === "5");
  assert.equal(cancelled.counted, false);
  assert.equal(cancelled.commissionCents, 0);
  assert.equal(r.items.find((i) => i.id === "6").refunded, true);
  assert.equal(r.items.find((i) => i.id === "6").counted, false);
  // ΙΔΙΟΣ υπολογισμός με την υπάρχουσα σύνοψη προμήθειας (καμία νέα λογική).
  for (const i of r.items.filter((x) => x.counted)) {
    const src = [row("1", "", 0, 150), row("2", "", 0, 100), row("3", "", 0, 40), row("4", "", 0, 60), row("7", "", 0, 80)].find((x) => x.id === i.id);
    assert.equal(i.commissionCents, Math.round(C.commissionFor(src, S10) * 100), i.id);
  }
  assert.equal(F.countsForPartnerTotals("CANCELLED", "NONE"), false);
  assert.equal(F.countsForPartnerTotals("COMPLETED", "REFUNDED"), false);
  assert.equal(F.countsForPartnerTotals("PENDING", "AWAITING_PAYMENT"), true);
  // Χωρίς ποσοστό: προμήθεια 0, το σύνολο κρατήσεων μένει.
  assert.equal(F.partnerFinance([row("1", "COMPLETED", 18000, 150)], C.NO_COMMISSION).totals.commissionCents, 0);
});

test("φίλτρο μήνα: YYYY-MM σε [αρχή, επόμενος μήνας)· άκυρο → 400", () => {
  assert.deepEqual(F.monthRange("2026-11"), { from: new Date("2026-11-01T00:00:00.000Z"), to: new Date("2026-12-01T00:00:00.000Z") });
  assert.deepEqual(F.monthRange("2026-12").to, new Date("2027-01-01T00:00:00.000Z"));
  for (const bad of ["2026-13", "2026-1", "x", "", null, "1999-01"]) assert.equal(F.monthRange(bad), null, String(bad));
  assert.match(read("src/app/api/partner/finance/route.ts"), /if \(month && !monthRange\(month\)\) return badRequest/);
});

test("στεγανότητα: ΜΟΝΟ οι κρατήσεις του ίδιου (partnerId) στην ΙΔΙΑ εταιρία, φίλτρο στο ερώτημα", () => {
  const s = read("src/lib/partnerServer.ts");
  assert.match(s, /const scope = bookingScope\(viewer\); \/\/ \{ tenantId, partnerId: ο ίδιος \}/);
  assert.match(s, /where: \{ \.\.\.scope, \.\.\.pickupIn\(month \? monthRange\(month\) : null\) \}/);
  assert.match(s, /range \? \{ pickupDate: \{ gte: range\.from, lt: range\.to \} \} : \{\};/);
  assert.match(read("src/lib/authz.ts"), /viewer\.role === "PARTNER"\s+\? \{ \.\.\.base, partnerId: viewer\.userId \}/);
  // Από τον πελάτη ΜΟΝΟ ονοματεπώνυμο στο κοινό select των οικονομικών.
  const select = s.slice(s.indexOf("const FINANCE_SELECT = {"), s.indexOf("} as const;", s.indexOf("const FINANCE_SELECT = {")));
  assert.match(select, /customer: \{ select: \{ firstName: true, lastName: true \} \},/);
  assert.doesNotMatch(select, /email|phone|idNumber|license|address|dateOfBirth/);
});

/* ── Διαθεσιμότητα ── */

test("διαθεσιμότητα: ελεύθερο/κατειλημμένο ανά όχημα και ημέρα, μόνο της ίδιας εταιρίας, χωρίς στοιχεία κρατήσεων", () => {
  const days = A.dayList("2026-11-10", 4);
  assert.deepEqual(days, ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
  const V = (id, extra = {}) => ({ id, tenantId: "T1", label: `Car ${id}`, status: "AVAILABLE", isActive: true, ...extra });
  const B = (vehicleId, status, pickupDate, returnDate, extra = {}) => ({
    id: `b-${vehicleId}-${pickupDate}`, bookingNumber: "BP-SECRET", tenantId: "T1", vehicleId, status, pickupDate, pickupTime: "10:00", returnDate, returnTime: "10:00", ...extra,
  });
  const grid = A.availabilityGrid({
    companyId: "T1",
    vehicles: [V("a"), V("b"), V("c", { status: "MAINTENANCE" }), { ...V("x"), tenantId: "T2" }],
    bookings: [
      B("a", "CONFIRMED", "2026-11-11", "2026-11-12"),
      B("b", "CANCELLED", "2026-11-10", "2026-11-13"),
      B("b", "PENDING", "2026-11-13", "2026-11-15", { tenantId: "T2" }),
    ],
    days,
  });
  assert.deepEqual(grid.map((r) => r.id), ["a", "b", "c"], "όχημα άλλης εταιρίας δεν φαίνεται");
  assert.deepEqual(grid[0].free, [true, false, false, true]);
  assert.deepEqual(grid[1].free, [true, true, true, true], "ακυρωμένη και άλλης εταιρίας δεν κλείνουν");
  assert.deepEqual(grid[2].free, [false, false, false, false], "εκτός λειτουργίας = κατειλημμένο");
  // Μόνο id/label/free — κανένα όνομα πελάτη ή αριθμός κράτησης.
  for (const r of grid) assert.deepEqual(Object.keys(r).sort(), ["free", "id", "label"]);
  assert.doesNotMatch(JSON.stringify(grid), /BP-SECRET|b-a-/);
  assert.equal(A.dayList("2026-11-10", 99).length, A.MAX_AVAILABILITY_DAYS);
  assert.deepEqual(A.dayList("bad", 3), []);
});

/* ── Κράτηση από συνεργάτη ── */

test("κράτηση συνεργάτη: τιμή ΜΟΝΟ από τον server, PENDING, στο όνομά του, χωρίς έκπτωση, σαφές 409, rate limit", () => {
  const s = read("src/app/api/partner/bookings/route.ts");
  // Το schema δεν δέχεται ποσά, έκπτωση, κατάσταση, συνεργάτη ή παράκαμψη (πρόσθετα/ασφάλεια ΜΟΝΟ ως ids).
  const schema = s.slice(s.indexOf("const schema = z.object({"), s.indexOf("const UNAVAILABLE"));
  assert.doesNotMatch(schema, /total|price|amount|discount|status|partnerId|override/i);
  assert.match(schema, /extraIds: z\.array\(z\.string\(\)\.min\(1\)\.max\(64\)\)\.max\(30\)\.optional\(\),/);
  assert.match(s, /extraIds: data\.extraIds \?\? \[\],\s+discountMode: "NONE",\s+\},\s+forceStatus: "PENDING",\s+source: "partner",/);
  assert.match(s, /if \(plan\.partnerId !== viewer\.userId \|\| plan\.conflictsAccepted\) return forbidden\(\);/);
  // Μη διαθέσιμο όχημα (λίστα, σύγκρουση, ή το πήρε κάποιος μέσα στο κλείδωμα) → ίδιο σαφές 409.
  assert.match(s, /if \(!free\.some\(\(v\) => v\.id === data\.vehicleId\)\) return unavailable\(\);/);
  assert.match(s, /if \(conflicts\.length > 0\) return unavailable\(\);/);
  assert.match(s, /if \(error instanceof BookingConflictError\) return unavailable\(\);/);
  assert.match(s, /code: "vehicle_unavailable",/);
  assert.match(s, /hitLimit\(dbCounterStore, LIMITS\.partnerBookingPerUser, viewer\.userId\)/);
  // Ίδια εγγραφή με κάθε κράτηση (advisory lock + επανέλεγχος σύγκρουσης).
  assert.match(s, /return writeBooking\(tx, plan, customerId\);/);
  assert.match(read("src/lib/bookingCreate.ts"), /SELECT pg_advisory_xact_lock\(hashtext\(\$\{lockKeyFor\(plan\.tenantId\)\}\)\)/);
  assert.match(read("src/lib/partners.ts"), /if \(viewer\.role === "PARTNER"\) \{\s+return \{ ok: true, partnerId: viewer\.userId \};/);
  assert.match(s, /commissionFor\(\s+\{ subtotal: plan\.breakdown\.subtotal, extrasTotal: plan\.breakdown\.extrasTotal, insuranceCost: plan\.breakdown\.insuranceCost \},\s+settings\s+\)/);
  const core = read("src/lib/billing/core.ts");
  assert.doesNotMatch(core.slice(core.indexOf("READ_ONLY_ALLOWED"), core.indexOf("export function readOnlyAllows")), /partner/);
});

test("διαθέσιμα οχήματα: ΙΔΙΑ λογική με το προσωπικό (loadWalkInVehicles), μόνο τα διαθέσιμα, μόνο id/ετικέτα", () => {
  const srv = read("src/lib/partnerServer.ts");
  assert.match(srv, /const list = await loadWalkInVehicles\(viewer\.tenantId, window, false\);/);
  assert.match(srv, /return list\.filter\(\(v\) => v\.available\)\.map\(\(v\) => \(\{ id: v\.id, label: `\$\{v\.brand\} \$\{v\.model\} · \$\{v\.plate\}` \}\)\);/);
  // Η λογική του προσωπικού: ίδιο ερώτημα δεσμεύσεων + blockedVehicleIds + εκτός λειτουργίας.
  const walk = read("src/lib/walkIn.ts");
  assert.match(walk, /loadBlockingBookings\(db, tenantId, \{ from, to \}, now\)/);
  assert.match(walk, /status: \{ notIn: \["MAINTENANCE", "INACTIVE"\] \}/);
  const route = read("src/app/api/partner/vehicles/route.ts");
  assert.match(route, /export const GET = withPermission\(/);
  assert.ok(route.trimEnd().endsWith('"partner.book"\n);'));
  assert.match(route, /if \(!isPartnerViewer\(viewer\)\) return forbidden\("Μόνο για συνεργάτες"\);/);
  // Η φόρμα: πρώτα διάστημα, μετά λίστα· αλλαγή διαστήματος → νέα λίστα και αφαίρεση άκυρης επιλογής.
  const ui = read("src/app/(dashboard)/dashboard/partner/availability/PartnerAvailabilityClient.tsx");
  assert.match(ui, /fetch\(`\/api\/partner\/vehicles\?\$\{params\}`/);
  assert.match(ui, /\}, \[win, ok, reloadVehicles, done\]\);/);
  assert.match(ui, /if \(current && !list\.some\(\(v\) => v\.id === current\)\) \{\s+setVehicleId\(""\);/);
  assert.match(ui, /if \(j\.code === "vehicle_unavailable"\) setReloadVehicles\(\(n\) => n \+ 1\);/);
  assert.match(ui, /disabled=\{!ok \|\| !vehicles\}/);
});

test("πελάτης: υπάρχων μόνο με ίδιο email/τηλέφωνο ΚΑΙ ίδιο ονοματεπώνυμο, χωρίς να το μαθαίνει ο συνεργάτης", () => {
  const srv = read("src/lib/partnerServer.ts");
  assert.match(srv, /const candidates = await findDuplicateCustomers\(tenantId, c\.phone \?\? "", c\.email \?\? ""\);/);
  assert.match(srv, /return same\.length === 1 \? same\[0\]\.id : null;/);
  const route = read("src/app/api/partner/bookings/route.ts");
  assert.match(route, /const existingId = await matchPartnerCustomer\(viewer\.tenantId, c\);/);
  // Η απάντηση δεν φανερώνει πελάτη: μόνο αριθμός/κατάσταση/ποσά της ΝΕΑΣ κράτησης.
  const resp = route.slice(route.indexOf("return created({"), route.indexOf("} catch (error)"));
  assert.doesNotMatch(resp, /customer|existing|matched/i);
  // Ο υπάρχων πελάτης δεν αλλάζει (καμία ενημέρωση πελάτη στη ροή).
  assert.doesNotMatch(route, /tx\.customer\.update/);
});
