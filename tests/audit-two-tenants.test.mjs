// tests/audit-two-tenants.test.mjs
// Έλεγχος (audit) απομόνωσης εταιριών με ΔΥΟ εταιρίες (T1, T2), στις καθαρές
// συναρτήσεις που αποφασίζουν τι βλέπει/δεσμεύει κάθε εταιρία. Καμία αλλαγή
// συμπεριφοράς — κλειδώνει τη σημερινή (σωστή) εικόνα. Τον έλεγχο των HTTP
// routes με πραγματική βάση τον κάνει το tests/e2e/idor-two-tenants.sh (μόνο
// σε ΤΟΠΙΚΗ βάση).

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const { countAvailableByGroup, freeVehicleIds } = await import("../src/lib/public/availability.ts");
const { visiblePlaces, findPublicPlace } = await import("../src/lib/public/places.ts");
const { manualReviews } = await import("../src/lib/public/reviews.ts");
const { vehiclePhotoFolder, groupPhotoFolder, placePhotoFolder, isPublicIdInFolder } = await import("../src/lib/vehiclePhotos.ts");
const { handleConnectEvent, checkSessionNow } = await import("../src/lib/public/paymentWebhook.ts");

const veh = (id, tenantId, groupKey = "g.A") => ({ id, tenantId, groupKey, status: "AVAILABLE", isActive: true });
const bk = (vehicleId, tenantId) => ({ tenantId, vehicleId, status: "CONFIRMED", pickupDate: "2027-03-01", pickupTime: "10:00", returnDate: "2027-03-05", returnTime: "10:00" });
const WIN = { from: "2027-03-02T10:00", to: "2027-03-03T10:00", prepMinutes: 0 };

test("διαθεσιμότητα: οχήματα και κρατήσεις της άλλης εταιρίας ΔΕΝ μετρούν", () => {
  const vehicles = [veh("a1", "T1"), veh("a2", "T1"), veh("b1", "T2")];
  // Κράτηση της T2 με id οχήματος της T1 (π.χ. πειραγμένο) → αγνοείται.
  const bookings = [bk("a1", "T2"), bk("b1", "T2")];
  assert.equal(countAvailableByGroup({ companyId: "T1", vehicles, bookings, ...WIN }).get("g.A"), 2);
  assert.deepEqual(freeVehicleIds({ companyId: "T1", vehicles, bookings, ...WIN }, "g.A"), ["a1", "a2"], "ποτέ όχημα της T2");
  assert.equal(countAvailableByGroup({ companyId: "T2", vehicles, bookings, ...WIN }).get("g.A"), 0, "η T2 βλέπει μόνο το δικό της (δεσμευμένο)");
});

test("μέρη / κριτικές: μόνο της εταιρίας του site", () => {
  const place = (slug, tenantId) => ({
    id: slug, tenantId, slug, nameI18n: { el: slug }, shortI18n: {}, descriptionI18n: {}, detailsI18n: [], mapUrl: null,
    coverImage: null, photos: [], allLocations: true, isActive: true, sortOrder: 0, locationIds: [],
  });
  const rows = [place("balos", "T1"), place("secret", "T2")];
  assert.deepEqual(visiblePlaces(rows, "T1", null).map((p) => p.slug), ["balos"]);
  assert.equal(findPublicPlace(rows, "T1", "secret"), null, "σελίδα μέρους άλλης εταιρίας → 404");
  const review = (id, tenantId) => ({ id, tenantId, authorName: "A", rating: 5, text: { el: "x" }, reviewDate: new Date("2026-10-01"), sourceUrl: null, isActive: true, sortOrder: 0 });
  assert.deepEqual(manualReviews([review("r1", "T1"), review("r2", "T2")], "T1", "el").map((r) => r.key ?? r.id).length, 1);
});

test("φωτογραφίες (Cloudinary): φάκελος ανά εταιρία· publicId άλλης εταιρίας απορρίπτεται", () => {
  const f1 = vehiclePhotoFolder("T1", "v1");
  assert.ok(f1 && f1.includes("T1"));
  assert.equal(isPublicIdInFolder(`${f1}/abc`, f1), true);
  assert.equal(isPublicIdInFolder(`${vehiclePhotoFolder("T2", "v1")}/abc`, f1), false, "ίδιο vehicleId, άλλη εταιρία");
  assert.equal(isPublicIdInFolder(`${f1}/../T2/x`, f1), false, "διαφυγή φακέλου");
  for (const fn of [groupPhotoFolder, placePhotoFolder]) {
    assert.notEqual(fn("T1", "x"), fn("T2", "x"));
  }
});

test("πληρωμές: event/έλεγχος από λογαριασμό ή session άλλης εταιρίας δεν αγγίζει κράτηση", async () => {
  const state = {
    bookings: [{ id: "B1", tenantId: "T1", vehicleId: "v", status: "PENDING", paymentStatus: "AWAITING_PAYMENT" }],
    payments: [{ id: "P1", tenantId: "T1", bookingId: "B1", session: "cs_1", status: "OPEN", amountCents: 1000, refundedCents: 0 }],
    events: new Set(),
  };
  let writes = 0;
  const store = {
    run: (fn) => fn({}),
    markEvent: async (_t, e) => (state.events.has(e.id) ? false : (state.events.add(e.id), true)),
    tenantByAccount: async (_t, a) => ({ acct_1: { id: "T1", rentalMode: "BOOKING" }, acct_2: { id: "T2", rentalMode: "BOOKING" } })[a] ?? null,
    paymentBySession: async (_t, tenantId, s) => state.payments.find((p) => p.tenantId === tenantId && p.session === s) ?? null,
    paymentByIntent: async () => null,
    booking: async (_t, tenantId, id) => state.bookings.find((b) => b.tenantId === tenantId && b.id === id) ?? null,
    applyTransition: async () => void writes++,
    updateAccount: async () => void writes++,
  };
  const session = { id: "cs_1", status: "complete", payment_status: "paid", amount_total: 1000, currency: "eur", payment_intent: "pi_1", metadata: { bookingId: "B1", tenantId: "T1" } };
  // Λογαριασμός της T2 στέλνει session της T1.
  assert.notEqual(await handleConnectEvent({ id: "e1", type: "checkout.session.completed", account: "acct_2", data: { object: session } }, store), "applied");
  // Ο εφεδρικός έλεγχος της T2 με session/λογαριασμό της T1.
  assert.equal(await checkSessionNow({ tenantId: "T2", payment: { stripeCheckoutSessionId: "cs_1", stripeAccountId: "acct_1" }, retrieve: async () => session }, store), "unknown_account");
  assert.equal(writes, 0);
});
