// tests/booking-decision.test.mjs
// Επιβεβαίωση / ακύρωση κράτησης από το dashboard + μήνυμα στον πελάτη.
// Λογική (bookingDecision), κείμενα (bookingMessages), σελίδα πελάτη
// (toConfirmationDTO), χειροκίνητη έκπτωση από το priceQuote. Χωρίς βάση.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const { planDecision, decideBooking, deliverEmail, canDecide, freeVehiclesFor, decisionSchema, DECISION_MSG } = await import(
  "../src/lib/bookingDecision.ts"
);
const {
  buildBookingMessage, messageLang, cancelReasonText, whatsappNumber, whatsappLink, mailtoLink, messageState,
  emailAlreadySent, kindForStatus,
} = await import("../src/lib/bookingMessages.ts");
const { toConfirmationDTO } = await import("../src/lib/public/bookingRequest.ts");
const { countAvailableByGroup } = await import("../src/lib/public/availability.ts");
const { storedManualDiscount } = await import("../src/lib/pricingBridge.ts");
const { STAFF_DEFAULTS, PARTNER_DEFAULTS, permissionsFromKeys } = await import("../src/lib/permissions.ts");

/* ─────────────────────────────────────────────
   Δεδομένα
   ───────────────────────────────────────────── */

const T = "tenantA";
const vehicles = [
  { id: "v1", tenantId: T, rentalGroupId: "grpB", status: "AVAILABLE", isActive: true },
  { id: "v2", tenantId: T, rentalGroupId: "grpB", status: "AVAILABLE", isActive: true },
  { id: "v3", tenantId: T, rentalGroupId: "grpC", status: "AVAILABLE", isActive: true },
  { id: "v4", tenantId: T, rentalGroupId: "grpB", status: "MAINTENANCE", isActive: true },
  // Άλλη εταιρία, ίδιο id ομάδας — ΠΟΤΕ στην ανάθεση.
  { id: "x1", tenantId: "tenantB", rentalGroupId: "grpB", status: "AVAILABLE", isActive: true },
];

const pending = (over = {}) => ({
  id: "bk1",
  tenantId: T,
  status: "PENDING",
  vehicleId: "v1",
  rentalGroupId: "grpB",
  pickupDate: "2026-12-11",
  pickupTime: "10:00",
  returnDate: "2026-12-15",
  returnTime: "10:00",
  ...over,
});

const other = (vehicleId, over = {}) => ({
  id: `o-${vehicleId}`,
  tenantId: T,
  vehicleId,
  status: "CONFIRMED",
  pickupDate: "2026-12-12",
  pickupTime: "10:00",
  returnDate: "2026-12-13",
  returnTime: "10:00",
  ...over,
});

const ctx = (blocking = [], prepMinutes = 60) => ({ vehicles, blocking, prepMinutes });

/* ─────────────────────────────────────────────
   Επιβεβαίωση: ανάθεση οχήματος / σύγκρουση
   ───────────────────────────────────────────── */

test("επιβεβαίωση: κρατά το τρέχον όχημα όταν είναι ελεύθερο", () => {
  const r = planDecision(pending(), { action: "confirm", notify: true }, ctx());
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, { status: "CONFIRMED", vehicleId: "v1" });
  assert.equal(r.kind, "confirm");
});

test("κράτηση χωρίς όχημα (μόνο ομάδα): ζητά επιλογή, μετά αναθέτει", () => {
  const b = pending({ vehicleId: null });
  const ask = planDecision(b, { action: "confirm", notify: true }, ctx());
  assert.equal(ask.ok, false);
  assert.equal(ask.status, 409);
  assert.deepEqual(ask.freeVehicleIds.sort(), ["v1", "v2"]); // όχι v3 (άλλη ομάδα), v4 (service), x1 (άλλη εταιρία)
  const ok = planDecision(b, { action: "confirm", vehicleId: "v2", notify: true }, ctx());
  assert.deepEqual(ok.patch, { status: "CONFIRMED", vehicleId: "v2" });
});

test("σύγκρουση: δεσμευμένο όχημα (και με χρόνο προετοιμασίας) δεν ανατίθεται", () => {
  // Άλλη κράτηση του v1 μέσα στο διάστημα → το v1 δεν είναι ελεύθερο.
  const r = planDecision(pending(), { action: "confirm", notify: true }, ctx([other("v1")]));
  assert.equal(r.ok, false);
  assert.equal(r.message, DECISION_MSG.vehicleNotFree);
  assert.deepEqual(r.freeVehicleIds, ["v2"]);
  // Επιστροφή 09:30 της ίδιας μέρας + 60΄ προετοιμασία > 10:00 → σύγκρουση.
  const prep = planDecision(
    pending(),
    { action: "confirm", vehicleId: "v2", notify: true },
    ctx([other("v2", { pickupDate: "2026-12-05", returnDate: "2026-12-11", returnTime: "09:30" })])
  );
  assert.equal(prep.ok, false);
  // Χωρίς χρόνο προετοιμασίας περνά.
  const noPrep = planDecision(
    pending(),
    { action: "confirm", vehicleId: "v2", notify: true },
    ctx([other("v2", { pickupDate: "2026-12-05", returnDate: "2026-12-11", returnTime: "09:30" })], 0)
  );
  assert.equal(noPrep.ok, true);
  // Όχημα άλλης ομάδας ή άλλης εταιρίας: ποτέ.
  assert.equal(planDecision(pending(), { action: "confirm", vehicleId: "v3", notify: true }, ctx()).ok, false);
  assert.equal(planDecision(pending(), { action: "confirm", vehicleId: "x1", notify: true }, ctx()).ok, false);
});

test("κανένα ελεύθερο όχημα: καθαρό μήνυμα, δεν επιβεβαιώνει", () => {
  const r = planDecision(pending(), { action: "confirm", notify: true }, ctx([other("v1"), other("v2")]));
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.message, DECISION_MSG.noFreeVehicle);
  assert.deepEqual(r.freeVehicleIds, []);
});

test("η ίδια η κράτηση δεν «κλείνει» το δικό της όχημα· ακυρωμένες δεν μετρούν", () => {
  const self = { ...other("v1"), id: "bk1", status: "PENDING" };
  assert.ok(freeVehiclesFor(pending(), vehicles, [self], 60).includes("v1"));
  assert.ok(freeVehiclesFor(pending(), vehicles, [other("v1", { status: "CANCELLED" })], 60).includes("v1"));
});

test("μεταβάσεις: μόνο PENDING → CONFIRMED· ακύρωση από PENDING/CONFIRMED, όχι από COMPLETED/CANCELLED", () => {
  assert.equal(planDecision(pending({ status: "CONFIRMED" }), { action: "confirm", notify: true }, ctx()).status, 400);
  assert.equal(planDecision(pending({ status: "COMPLETED" }), { action: "cancel", notify: true }, ctx()).status, 400);
  assert.equal(planDecision(pending({ status: "CANCELLED" }), { action: "cancel", notify: true }, ctx()).status, 400);
  assert.equal(planDecision(pending({ status: "CONFIRMED" }), { action: "cancel", notify: true }, ctx()).ok, true);
});

test("ακύρωση: λόγος + σημείωμα χωρίς HTML, και ελευθερώνει τη διαθεσιμότητα", () => {
  const r = planDecision(pending(), { action: "cancel", reasonCode: "no_vehicle", note: " <b>Λυπούμαστε</b>  πολύ ", notify: true }, ctx());
  assert.deepEqual(r.patch, { status: "CANCELLED", cancelReasonCode: "no_vehicle", cancelNote: "Λυπούμαστε πολύ" });

  const fleet = vehicles.map((v) => ({ id: v.id, tenantId: v.tenantId, groupKey: v.rentalGroupId, status: v.status, isActive: v.isActive }));
  const input = (status) => ({
    companyId: T,
    vehicles: fleet,
    bookings: [{ ...other("v1"), status }, other("v2")],
    from: "2026-12-12T10:00",
    to: "2026-12-13T10:00",
    prepMinutes: 0,
  });
  assert.equal(countAvailableByGroup(input("PENDING")).get("grpB"), 0);
  assert.equal(countAvailableByGroup(input("CANCELLED")).get("grpB"), 1);
});

test("σχήμα: άγνωστος λόγος ή ενέργεια απορρίπτεται", () => {
  assert.equal(decisionSchema.safeParse({ action: "cancel", reasonCode: "because" }).success, false);
  assert.equal(decisionSchema.safeParse({ action: "delete" }).success, false);
  assert.equal(decisionSchema.parse({ action: "confirm" }).notify, true);
});

/* ─────────────────────────────────────────────
   Ρόλοι
   ───────────────────────────────────────────── */

test("ρόλοι: Admin και Staff ναι, Partner ΠΟΤΕ (ακόμη και με δικαιώματα), Super Admin όχι", () => {
  assert.equal(canDecide("COMPANY_ADMIN", {}, "confirm"), true);
  assert.equal(canDecide("STAFF", permissionsFromKeys(STAFF_DEFAULTS), "confirm"), true);
  assert.equal(canDecide("STAFF", permissionsFromKeys(STAFF_DEFAULTS), "cancel"), true);
  assert.equal(canDecide("STAFF", permissionsFromKeys(["bookings.view", "bookings.cancel"]), "confirm"), false);
  assert.equal(canDecide("STAFF", permissionsFromKeys(["bookings.view", "bookings.cancel"]), "cancel"), true);
  assert.equal(canDecide("PARTNER", permissionsFromKeys(PARTNER_DEFAULTS), "confirm"), false);
  assert.equal(canDecide("PARTNER", permissionsFromKeys(["bookings.status", "bookings.cancel"]), "cancel"), false);
  assert.equal(canDecide("SUPER_ADMIN", {}, "confirm"), false);
});

/* ─────────────────────────────────────────────
   Εκτέλεση με ψεύτικη βάση / Resend
   ───────────────────────────────────────────── */

const MESSAGE = { lang: "en", subject: "S", text: "T", html: "<p>T</p>" };

function fakes({ booking = pending(), blocking = [], sendError = null, sendThrows = false, rows = [], email = "c@example.com", apiKey = "k", from = "Co <a@b.c>" } = {}) {
  const calls = { apply: [], send: [], record: [] };
  const store = {
    withLock: (fn) => fn("tx"),
    loadBooking: async () => booking,
    loadVehicles: async () => vehicles,
    loadBlocking: async () => blocking,
    prepMinutes: async () => 60,
    nowLocal: () => "2026-10-16T09:00",
    apply: async (_tx, patch) => {
      calls.apply.push(patch);
    },
  };
  const messages = {
    apiKey,
    from,
    loadNotifications: async () => rows,
    buildMessage: async () => ({ message: MESSAGE, to: email, replyTo: null }),
    send: async (_k, e) => {
      calls.send.push(e);
      if (sendThrows) throw new Error("network");
      return { error: sendError };
    },
    record: async (row) => {
      calls.record.push(row);
    },
  };
  return { store, messages, calls };
}

const ADMIN = { role: "COMPANY_ADMIN", permissions: {} };

test("επιτυχία: CONFIRMED + email στάλθηκε + καταγραφή", async () => {
  const f = fakes();
  const r = await decideBooking(ADMIN, { action: "confirm", notify: true }, f.store, f.messages);
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "CONFIRMED");
  assert.equal(r.data.email, "sent");
  assert.equal(f.calls.apply.length, 1);
  assert.equal(f.calls.send.length, 1);
  assert.deepEqual(f.calls.record, [{ kind: "confirm", channel: "email", result: "sent", error: null, lang: "en" }]);
});

test("αποτυχία email ΔΕΝ σπάει την αλλαγή κατάστασης", async () => {
  for (const opts of [{ sendError: "domain_unverified" }, { sendThrows: true }]) {
    const f = fakes(opts);
    const r = await decideBooking(ADMIN, { action: "cancel", reasonCode: "other", notify: true }, f.store, f.messages);
    assert.equal(r.status, 200);
    assert.equal(r.data.status, "CANCELLED");
    assert.equal(r.data.email, "failed");
    assert.equal(f.calls.apply.length, 1);
    assert.equal(f.calls.record[0].result, "failed");
  }
  // Χωρίς RESEND_API_KEY: καμία προσπάθεια, καταγράφεται «δεν στάλθηκε».
  const f = fakes({ apiKey: "" });
  const r = await decideBooking(ADMIN, { action: "confirm", notify: true }, f.store, f.messages);
  assert.equal(r.status, 200);
  assert.equal(r.data.email, "not_configured");
  assert.equal(f.calls.send.length, 0);
  assert.equal(f.calls.record[0].error, "not_configured");
  // Σφάλμα ΑΚΟΜΗ και στο φόρτωμα του μηνύματος → η κράτηση μένει επιβεβαιωμένη.
  const g = fakes();
  g.messages.buildMessage = async () => {
    throw new Error("db");
  };
  const r2 = await decideBooking(ADMIN, { action: "confirm", notify: true }, g.store, g.messages);
  assert.equal(r2.status, 200);
  assert.equal(r2.data.status, "CONFIRMED");
  assert.equal(r2.data.email, "failed");
});

test("δεν στέλνεται διπλό μήνυμα· χωρίς email πελάτη ή χωρίς τικ δεν στέλνεται", async () => {
  const sent = [{ kind: "confirm", channel: "email", result: "sent" }];
  const f = fakes({ rows: sent });
  assert.deepEqual(await deliverEmail("confirm", f.messages), { email: "already_sent", emailError: null });
  assert.equal(f.calls.send.length, 0);
  // Άλλο είδος (ακύρωση) ΜΕΤΑ από επιβεβαίωση: στέλνεται κανονικά.
  assert.equal((await deliverEmail("cancel", f.messages)).email, "sent");
  // Αποτυχημένο ή WhatsApp δεν μετρά ως «email στάλθηκε».
  assert.equal(emailAlreadySent([{ kind: "confirm", channel: "email", result: "failed" }], "confirm"), false);
  assert.equal(emailAlreadySent([{ kind: "confirm", channel: "whatsapp", result: "opened" }], "confirm"), false);

  const n = fakes({ email: null });
  assert.equal((await deliverEmail("confirm", n.messages)).email, "no_email");
  const off = fakes();
  const r = await decideBooking(ADMIN, { action: "confirm", notify: false }, off.store, off.messages);
  assert.equal(r.data.email, "not_requested");
  assert.equal(off.calls.send.length, 0);
});

test("ρόλος/εταιρία: Partner 403 χωρίς καμία εγγραφή· κράτηση άλλης εταιρίας 404", async () => {
  const f = fakes();
  const r = await decideBooking({ role: "PARTNER", permissions: { "bookings.status": true } }, { action: "confirm", notify: true }, f.store, f.messages);
  assert.equal(r.status, 403);
  assert.equal(f.calls.apply.length, 0);
  // Το loadBooking φιλτράρει με tenantId της συνεδρίας → null για ξένη κράτηση.
  const g = fakes({ booking: null });
  const r2 = await decideBooking(ADMIN, { action: "cancel", notify: true }, g.store, g.messages);
  assert.equal(r2.status, 404);
  assert.equal(g.calls.apply.length, 0);
  assert.equal(g.calls.send.length, 0);
});

test("409 χωρίς ελεύθερο όχημα: τίποτα δεν γράφεται, τίποτα δεν στέλνεται", async () => {
  const f = fakes({ blocking: [other("v1"), other("v2")] });
  const r = await decideBooking(ADMIN, { action: "confirm", notify: true }, f.store, f.messages);
  assert.equal(r.status, 409);
  assert.equal(f.calls.apply.length, 0);
  assert.equal(f.calls.send.length, 0);
});

/* ─────────────────────────────────────────────
   Γλώσσα και περιεχόμενο μηνυμάτων
   ───────────────────────────────────────────── */

test("γλώσσα μηνύματος: του site → της εταιρίας → ελληνικά", () => {
  assert.equal(messageLang("en", "el"), "en");
  assert.equal(messageLang("el", "en"), "el");
  assert.equal(messageLang(null, "en"), "en"); // παλιά κράτηση → προεπιλογή εταιρίας
  assert.equal(messageLang("fr", "en"), "en"); // γλώσσα χωρίς λεξικό
  assert.equal(messageLang(null, null), "el");
  assert.equal(messageLang(undefined, "xx"), "el");
});

const data = (over = {}) => ({
  kind: "confirm",
  lang: "en",
  code: "T7NF-TV74",
  firstName: "Maria",
  groupName: "Category B · Economy",
  groupSimilar: "Fiat Panda",
  from: "2026-12-11T10:00",
  to: "2026-12-15T10:00",
  pickupLocation: "Chania Airport",
  returnLocation: null,
  totalCents: 11300, // από το αποθηκευμένο priceQuote
  company: { name: "Fleet-Pro Car Rental", phone: "+30 6900 000000", email: "book@fleetpro.test" },
  bookingUrl: "https://x.test/s/fleet-pro-chania/en/booking/T7NF-TV74",
  searchUrl: "https://x.test/s/fleet-pro-chania/en",
  ...over,
});

test("μήνυμα επιβεβαίωσης (en): κωδικός, ομάδα «or similar», ώρες, σημεία, σύνολο από priceQuote, πληρωμή, link, επικοινωνία", () => {
  const m = buildBookingMessage(data());
  assert.equal(m.lang, "en");
  assert.match(m.subject, /T7NF-TV74 confirmed · Fleet-Pro Car Rental/);
  for (const s of [
    "Hello Maria,",
    "Thank you for choosing Fleet-Pro Car Rental",
    "Booking code: T7NF-TV74",
    "Category B · Economy (Fiat Panda or similar)",
    "Fri 11 Dec 2026, 10:00 · Chania Airport",
    "Tue 15 Dec 2026, 10:00 · Chania Airport", // επιστροφή στο ίδιο σημείο
    "€113",
    "Payment at pick-up.",
    "https://x.test/s/fleet-pro-chania/en/booking/T7NF-TV74",
    "+30 6900 000000",
    "book@fleetpro.test",
  ]) {
    assert.ok(m.text.includes(s), `λείπει: ${s}`);
  }
  assert.ok(m.html.includes('<a href="https://x.test/s/fleet-pro-chania/en/booking/T7NF-TV74"'));
});

test("μήνυμα επιβεβαίωσης (el) και μήνυμα ακύρωσης με λόγο + link νέας αναζήτησης", () => {
  const el = buildBookingMessage(data({ lang: "el", groupName: "Κατηγορία B", groupSimilar: "Fiat Panda", pickupLocation: "Αεροδρόμιο Χανίων" }));
  assert.match(el.subject, /επιβεβαιώθηκε/);
  assert.ok(el.text.includes("Fiat Panda ή παρόμοιο"));
  assert.ok(el.text.includes("Παρ 11 Δεκ 2026, 10:00 · Αεροδρόμιο Χανίων"));
  assert.match(el.text, /113\s€/);
  assert.ok(el.text.includes("Πληρωμή στην παραλαβή."));

  const c = buildBookingMessage(data({ kind: "cancel", reasonCode: "no_vehicle", note: "Δοκιμάστε την επόμενη εβδομάδα." , lang: "el" }));
  assert.match(c.subject, /ακυρώθηκε/);
  assert.ok(c.text.includes("T7NF-TV74"));
  assert.ok(c.text.includes("Δεν υπάρχει διαθέσιμο όχημα για αυτές τις ημερομηνίες. Δοκιμάστε την επόμενη εβδομάδα."));
  assert.ok(c.text.includes("https://x.test/s/fleet-pro-chania/en"));
  assert.ok(!c.text.includes("113")); // η ακύρωση δεν δείχνει τιμή
  // HTML από τον διαχειριστή δεν περνά στο email.
  const x = buildBookingMessage(data({ kind: "cancel", note: '<script>alert(1)</script>"x"' }));
  assert.ok(!x.html.includes("<script>"));
});

test("WhatsApp / mailto: μόνο ψηφία, κωδικός χώρας, ίδιο κείμενο", () => {
  assert.equal(whatsappNumber("+30 690 000 0000"), "306900000000");
  assert.equal(whatsappNumber("0044 7700 900123"), "447700900123");
  assert.equal(whatsappNumber("6912345678"), "306912345678");
  assert.equal(whatsappNumber("abc"), null);
  const m = buildBookingMessage(data());
  const wa = whatsappLink("+30 6900000000", m.text);
  assert.ok(wa.startsWith("https://wa.me/306900000000?text="));
  assert.equal(decodeURIComponent(wa.split("text=")[1]), m.text);
  const mail = mailtoLink("c@example.com", m.subject, m.text);
  assert.ok(mail.startsWith("mailto:c%40example.com?subject="));
  assert.equal(mailtoLink("not-an-email", "s", "t"), null);
});

test("κατάσταση αποστολής για το dashboard", () => {
  assert.equal(messageState([], "confirm"), "none");
  assert.equal(messageState([{ kind: "confirm", result: "failed" }], "confirm"), "failed");
  assert.equal(messageState([{ kind: "confirm", result: "failed" }, { kind: "confirm", result: "opened" }], "confirm"), "sent");
  assert.equal(messageState([{ kind: "cancel", result: "sent" }], "confirm"), "none");
  assert.equal(kindForStatus("CONFIRMED"), "confirm");
  assert.equal(kindForStatus("CANCELLED"), "cancel");
  assert.equal(kindForStatus("PENDING"), null);
});

/* ─────────────────────────────────────────────
   Σελίδα του πελάτη
   ───────────────────────────────────────────── */

const src = (over = {}) => ({
  publicCode: "T7NF-TV74",
  status: "PENDING",
  pickupDate: new Date("2026-12-11T00:00:00Z"),
  pickupTime: "10:00",
  returnDate: new Date("2026-12-15T00:00:00Z"),
  returnTime: "10:00",
  pickupLocation: "Αεροδρόμιο Χανίων",
  returnLocation: "Αεροδρόμιο Χανίων",
  priceQuote: { version: 1, totalCents: 11300, quote: { lines: [] } },
  total: 93,
  customer: { firstName: "Maria", email: "maria.k@example.com" },
  groupName: "Κατηγορία B",
  groupSimilar: "Toyota Yaris",
  photoUrl: null,
  cancelReasonCode: "no_vehicle",
  cancelNote: "Σημείωμα",
  // Ό,τι δεν πρέπει να φτάσει ποτέ στη σελίδα:
  phone: "+30 6900000000",
  flightNumber: "LO 123",
  notes: "Arriving late",
  ...over,
});

test("σελίδα πελάτη: σωστή κατάσταση, λόγος ΜΟΝΟ σε ακυρωμένη, χωρίς ιδιωτικά πεδία", () => {
  const p = toConfirmationDTO(src());
  assert.equal(p.status, "PENDING");
  assert.equal(p.cancelReasonCode, null); // σε μη ακυρωμένη δεν φεύγει
  assert.equal(p.totalCents, 11300);
  const c = toConfirmationDTO(src({ status: "CANCELLED" }));
  assert.equal(c.status, "CANCELLED");
  assert.equal(c.cancelReasonCode, "no_vehicle");
  assert.equal(cancelReasonText("en", c.cancelReasonCode, c.cancelNote), "No vehicle is available for these dates. Σημείωμα");
  assert.equal(toConfirmationDTO(src({ status: "CONFIRMED" })).status, "CONFIRMED");

  const json = JSON.stringify(c);
  for (const leak of ["6900000000", "LO 123", "Arriving", "maria.k@", "Kowalska"]) assert.ok(!json.includes(leak), `διαρροή: ${leak}`);
  assert.deepEqual(Object.keys(c).sort(), [
    "cancelNote", "cancelReasonCode", "code", "depositCents", "excessCents", "firstName", "from", "groupName", "groupSimilar",
    "insurance", "lines", "listTotalCents", "maskedEmail", "payment", "photoUrl", "pickupLocation", "returnLocation", "status", "to", "totalCents", "vatCents",
  ]);
});

/* ─────────────────────────────────────────────
   Η αιτία του διπλού: προσφορά ≠ χειροκίνητη έκπτωση
   ───────────────────────────────────────────── */

test("χειροκίνητη έκπτωση ΜΟΝΟ από το priceQuote (η αυτόματη προσφορά δεν διπλομετρά)", () => {
  // Κράτηση του site με προσφορά −20 €: discountAmount 20 αλλά καμία χειροκίνητη.
  assert.equal(storedManualDiscount({ version: 1, manualDiscount: null, totalCents: 11300 }), null);
  assert.deepEqual(storedManualDiscount({ version: 1, manualDiscount: { cents: 1500, code: null } }), { cents: 1500, code: null });
  assert.deepEqual(storedManualDiscount({ version: 1, manualDiscount: { cents: 0, code: "SUMMER" } }), { cents: 0, code: "SUMMER" });
  // Παλιά κράτηση χωρίς priceQuote → undefined (ισχύει το discountAmount, όπως πριν).
  assert.equal(storedManualDiscount(null), undefined);
});
