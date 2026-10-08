// tests/contract-email.test.mjs
// «Αποστολή στον πελάτη» (email + PDF): src/lib/contractEmail.ts,
// src/lib/contractEmailSend.ts (403/404/409/400/500/429/502/200 με mock
// Resend) και src/lib/contractPdf.ts (ποτέ πλήρης αριθμός κάρτας).
// Τρέχει με `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Τα src/lib κάνουν σχετικά imports χωρίς κατάληξη ("./contracts"):
// μικρός resolver που δοκιμάζει και ".ts" (όπως στο price-override.test).
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const {
  EMAIL_MSG,
  EMAIL_SEND_LIMIT,
  emailContent,
  isEmail,
  maskEmail,
  nextAllowedAt,
  recentAttempts,
  stripCardNumbers,
  suggestEmailLang,
} = await import("../src/lib/contractEmail.ts");
const { sendContractEmail, canSendContractEmail } = await import("../src/lib/contractEmailSend.ts");
const { buildContractPdf, maskedCard } = await import("../src/lib/contractPdf.ts");
const { PDFDocument, PDFPage } = await import("pdf-lib");

const PAN = "4111111111111111";
const PAN_SPACED = "5500 0000 0000 0004";
const EMAIL = "maria.p@example.com";
const TOKEN = "A".repeat(43);
const ORIGIN = "https://fleetpro-v2.vercel.app";

/** Όλες οι σειρές 13+ ψηφίων (και με κενά/παύλες) σε ένα κείμενο. */
const cardRuns = (s) => (s.match(/\d(?:[ .\-]?\d)*/g) ?? []).filter((r) => r.replace(/\D/g, "").length >= 13);

/* ─────────────────────────────────────────────
   Δεδομένα
   ───────────────────────────────────────────── */

function makeContract(over = {}) {
  const driver = {
    id: "d1",
    fullName: "Μαρία Παπαδοπούλου",
    country: "Ελλάδα",
    licenseNumber: "AB123456",
    licenseExpiry: "2030-01-01",
    birthDate: "1990-05-05",
    idType: "ID",
    idNumber: "AK 123456",
    phone: "+30 6912345678",
    email: EMAIL,
    address: `Οδός Ερμού 10, Αθήνα (κάρτα ${PAN})`,
    signature: null,
    signedAt: "2026-10-08T09:30:00.000Z",
  };
  return {
    id: "c1",
    contractNumber: "C-7F3K9Q",
    status: "SIGNED",
    bookingId: "b1",
    bookingNumber: "BK-1001",
    bookingStatus: "CONFIRMED",
    createdByName: "Γιάννης",
    snapshot: {
      company: {
        name: "Κρήτη Rent ΙΚΕ",
        region: "Χανιά",
        vat: "123456789",
        taxOffice: "Χανίων",
        phone: "2821012345",
        email: "info@kriti-rent.gr",
        address: "Λεωφόρος Σούδας 5, Χανιά, με πολύ μεγάλη διεύθυνση που πρέπει να αναδιπλωθεί σωστά σε δύο γραμμές",
        logoUrl: null,
      },
      booking: {
        number: "BK-1001",
        pickupDate: "2026-10-08",
        pickupTime: "10:00",
        returnDate: "2026-10-12",
        returnTime: "18:00",
        totalDays: 4,
        dailyRate: 40,
        subtotal: 160,
        extrasTotal: 20,
        insuranceCost: 24,
        discountAmount: 0,
        discountCode: null,
        total: 204,
      },
      vehicle: { id: "v1", brand: "Toyota", model: "Yaris Hybrid", plate: "ΧΝΗ 1234", fuel: "HYBRID" },
      extras: [{ name: "Παιδικό κάθισμα / Child seat", lineTotal: 20 }],
      insurance: [{ name: "Πλήρης ασφάλεια / Full insurance (SCDW) με μεγάλο όνομα για αναδίπλωση", lineTotal: 24, excess: 300 }],
      terms: {
        el: `1. Ο μισθωτής επιστρέφει το όχημα με το ίδιο καύσιμο.\n2. Παράδειγμα αριθμού ${PAN_SPACED} που πρέπει να αφαιρεθεί.`,
        en: "1. The renter returns the vehicle with the same fuel level.",
      },
      vatRate: 24,
      takenAt: "2026-10-08T09:00:00.000Z",
    },
    drivers: [driver],
    pickupLocation: "Αεροδρόμιο Χανίων",
    returnLocation: "Λιμάνι Σούδας",
    fuelType: "HYBRID",
    fuelPickup: 6,
    fuelReturn: null,
    damageMarks: [],
    damagePhotos: [
      { id: "p1", group: "PICKUP", url: null, takenAt: null, note: "" },
      { id: "p2", group: "PICKUP", url: null, takenAt: null, note: "" },
    ],
    damageNotesPickup: "Γρατζουνιά μπροστινός προφυλακτήρας",
    damageNotesReturn: "",
    vehicleChanges: [],
    notes: `Πλήρωσε με την κάρτα ${PAN} — CVV δεν κρατήθηκε. Τηλ. 6912345678.`,
    paymentMethod: "CARD",
    depositAmount: 300,
    depositMethod: "CARD_HOLD",
    paymentCard: { brand: "VISA", last4: "1111", holder: "MARIA P", expiry: "08/27" },
    depositCard: { brand: "MASTERCARD", last4: "0004", holder: "MARIA P", expiry: "09/28" },
    cardNumberSaved: { payment: true, deposit: true },
    gdprConsent: true,
    signedAt: "2026-10-08T09:30:00.000Z",
    completedAt: null,
    createdAt: "2026-10-08T09:00:00.000Z",
    updatedAt: "2026-10-08T09:30:00.000Z",
    bookingExtraIds: [],
    bookingTotalNow: 204,
    extrasLock: "signed",
    licensePhotos: [],
    publicLink: { state: "active", token: TOKEN, expiresAt: "2027-01-11T00:00:00.000Z" },
    ...over,
  };
}

/** Ψεύτικες εξαρτήσεις: ιστορικό στη μνήμη με το ΙΔΙΟ όριο, mock Resend. */
function makeDeps(over = {}) {
  const state = { log: [], sent: [], finished: [], reserveCalls: 0, sentAt: null };
  let clock = Date.parse("2026-10-08T10:00:00.000Z");
  let n = 0;
  const contract = over.contract ?? makeContract();
  const deps = {
    apiKey: "re_test_123",
    from: "onboarding@resend.dev",
    loadContract: async () => (contract ? { contract, link: contract.publicLink, vatRate: 24 } : null),
    reserveAttempt: async (entry) => {
      state.reserveCalls++;
      const now = new Date(entry.at);
      if (recentAttempts(state.log, now) >= EMAIL_SEND_LIMIT) {
        return { ok: false, recent: recentAttempts(state.log, now), retryAt: nextAllowedAt(state.log, now) };
      }
      state.log.push(entry);
      return { ok: true, entry };
    },
    finishAttempt: async (id, o) => {
      state.finished.push({ id, ...o });
      const e = state.log.find((x) => x.id === id);
      if (e) Object.assign(e, { ok: o.ok, ...(o.error ? { error: o.error } : {}) });
      if (o.ok) state.sentAt = o.at;
    },
    buildPdf: async (c, url, vatRate) => buildContractPdf({ contract: c, url, fallbackVatRate: vatRate }),
    send: async (_key, email) => {
      state.sent.push(email);
      return { error: null };
    },
    now: () => new Date((clock += 1000)),
    newId: () => `e${++n}`,
    ...over,
  };
  delete deps.contract;
  if ("contract" in over && over.contract === null) deps.loadContract = async () => null;
  return { deps, state, advance: (ms) => (clock += ms) };
}

const req = (o = {}) => ({ role: "STAFF", userId: "u1", origin: ORIGIN, lang: "el", ...o });

/** Καταγράφει ό,τι γράφεται στο console.error όσο τρέχει το fn. */
async function captureErrors(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => lines.push(a.map(String).join(" "));
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = orig;
  }
}

/** Όλα τα κείμενα που ζωγραφίζει το PDF (πριν τη συμπίεση/κωδικοποίηση). */
async function pdfTexts(input) {
  const texts = [];
  const orig = PDFPage.prototype.drawText;
  PDFPage.prototype.drawText = function (text, opts) {
    texts.push(text);
    return orig.call(this, text, opts);
  };
  try {
    const bytes = await buildContractPdf(input);
    return { bytes, texts };
  } finally {
    PDFPage.prototype.drawText = orig;
  }
}

/* ─────────────────────────────────────────────
   Καθαρή λογική
   ───────────────────────────────────────────── */

test("γλώσσα: κενή χώρα ή Ελλάδα → el, αλλιώς en", () => {
  for (const c of ["", "  ", null, undefined, "Ελλάδα", "ΕΛΛΑΔΑ", "ελλάς", "Greece", "GR", "Hellas"]) {
    assert.equal(suggestEmailLang(c), "el", String(c));
  }
  for (const c of ["Germany", "Γερμανία", "Κύπρος", "UK", "Italia"]) assert.equal(suggestEmailLang(c), "en", c);
});

test("stripCardNumbers: σειρές 13+ ψηφίων φεύγουν, τηλέφωνα/ημερομηνίες/ποσά μένουν", () => {
  assert.equal(stripCardNumbers(`κάρτα ${PAN} ok`), "κάρτα [•••] ok");
  assert.equal(stripCardNumbers(`κάρτα ${PAN_SPACED}`), "κάρτα [•••]");
  assert.equal(stripCardNumbers("4111-1111-1111-1111"), "[•••]");
  assert.equal(stripCardNumbers("4222222222222"), "[•••]"); // 13
  assert.equal(stripCardNumbers("1".repeat(19)), "[•••]");
  for (const keep of ["6912345678", "+30 210 1234567", "08/10/2026", "1.234,56 €", "AB123456", "•••• 1234"]) {
    assert.equal(stripCardNumbers(keep), keep);
  }
});

test("maskEmail / isEmail / maskedCard", () => {
  assert.equal(maskEmail(EMAIL), "m***@example.com");
  assert.ok(isEmail(EMAIL));
  assert.ok(!isEmail(""));
  assert.ok(!isEmail("όχι email"));
  assert.equal(maskedCard({ brand: "VISA", last4: "1234", holder: "X", expiry: "01/30" }), "Visa\u00a0••••\u00a01234");
  assert.equal(maskedCard(null), "");
});

test("email: θέμα/κείμενο ΕΛ και EN με το link, χωρίς αριθμό κάρτας", () => {
  const base = {
    companyName: "Κρήτη Rent",
    companyPhone: "2821012345",
    companyEmail: "info@kriti-rent.gr",
    contractNumber: "C-7F3K9Q",
    customerName: `Μαρία ${PAN}`,
    url: `${ORIGIN}/c/${TOKEN}`,
    photoCount: 2,
  };
  const el = emailContent({ ...base, lang: "el" });
  assert.match(el.subject, /^Το συμβόλαιο ενοικίασης C-7F3K9Q/);
  assert.ok(el.text.includes(`${ORIGIN}/c/${TOKEN}`));
  assert.ok(el.html.includes(`${ORIGIN}/c/${TOKEN}`));
  assert.match(el.text, /φωτογραφίες ζημιών \(2\)/);
  const en = emailContent({ ...base, lang: "en" });
  assert.match(en.subject, /^Your rental agreement C-7F3K9Q/);
  assert.match(en.text, /View the agreement online/);
  for (const c of [el, en]) {
    for (const s of [c.subject, c.text, c.html]) assert.deepEqual(cardRuns(s), []);
  }
  assert.equal(el.filename, "contract-C-7F3K9Q.pdf");
});

test("email: HTML escaping του ονόματος εταιρίας", () => {
  const c = emailContent({
    lang: "el", companyName: "<script>x</script>", companyPhone: "", companyEmail: "",
    contractNumber: "C-1", customerName: "", url: `${ORIGIN}/c/${TOKEN}`, photoCount: 0,
  });
  assert.ok(!c.html.includes("<script>"));
});

test("ρόλοι: Διαχειριστής και Προσωπικό ναι, συνεργάτης όχι", () => {
  assert.ok(canSendContractEmail("COMPANY_ADMIN"));
  assert.ok(canSendContractEmail("STAFF"));
  assert.ok(!canSendContractEmail("PARTNER"));
  assert.ok(!canSendContractEmail("SUPER_ADMIN"));
});

/* ─────────────────────────────────────────────
   Ροή αποστολής
   ───────────────────────────────────────────── */

test("συνεργάτης → 403, χωρίς καμία προσπάθεια", async () => {
  const { deps, state } = makeDeps();
  const r = await sendContractEmail(req({ role: "PARTNER" }), deps);
  assert.equal(r.status, 403);
  assert.equal(r.message, EMAIL_MSG.partner);
  assert.equal(state.reserveCalls, 0);
  assert.equal(state.sent.length, 0);
});

test("ανύπαρκτο / ξένο συμβόλαιο → 404", async () => {
  const { deps } = makeDeps({ contract: null });
  assert.equal((await sendContractEmail(req(), deps)).status, 404);
});

test("χωρίς υπογραφή (DRAFT) → 409", async () => {
  const { deps, state } = makeDeps({ contract: makeContract({ status: "DRAFT" }) });
  const r = await sendContractEmail(req(), deps);
  assert.equal(r.status, 409);
  assert.equal(r.message, EMAIL_MSG.notSigned);
  assert.equal(state.reserveCalls, 0);
});

test("χωρίς email κύριου οδηγού → 400 «Λείπει email πελάτη»", async () => {
  const c = makeContract();
  c.drivers = [{ ...c.drivers[0], email: "" }];
  const { deps, state } = makeDeps({ contract: c });
  const r = await sendContractEmail(req(), deps);
  assert.equal(r.status, 400);
  assert.match(r.message, /Λείπει email πελάτη/);
  assert.equal(state.reserveCalls, 0);
});

test("ανενεργό link → 409", async () => {
  const { deps } = makeDeps({
    contract: makeContract({ publicLink: { state: "revoked", token: null, expiresAt: null } }),
  });
  const r = await sendContractEmail(req(), deps);
  assert.equal(r.status, 409);
  assert.equal(r.message, EMAIL_MSG.linkInactive);
});

test("χωρίς RESEND_API_KEY → 500 με καθαρό μήνυμα, ΔΕΝ μετρά στο όριο", async () => {
  const { deps, state } = makeDeps({ apiKey: undefined });
  for (let i = 0; i < EMAIL_SEND_LIMIT + 2; i++) {
    const { result: r, lines } = await captureErrors(() => sendContractEmail(req(), deps));
    assert.equal(r.status, 500);
    assert.match(r.message, /RESEND_API_KEY/);
    assert.ok(lines.every((l) => !l.includes(EMAIL)));
  }
  assert.equal(state.reserveCalls, 0);
  assert.equal(state.log.length, 0);
  // Με κλειδί, η πρώτη αποστολή περνά κανονικά.
  deps.apiKey = "re_test_123";
  assert.equal((await sendContractEmail(req(), deps)).status, 200);
});

test("όριο 5 αποστολές/ώρα → 429 (μετρούν και οι αποτυχημένες), μετά από 1 ώρα ξανά", async () => {
  let fail = true;
  const { deps, state, advance } = makeDeps({
    send: async (_k, email) => {
      state.sent.push(email);
      return { error: fail ? "rate_limit_exceeded" : null };
    },
  });
  // 3 αποτυχίες στον πάροχο + 2 επιτυχίες = 5 προσπάθειες.
  for (let i = 0; i < 3; i++) {
    const { result: r, lines } = await captureErrors(() => sendContractEmail(req(), deps));
    assert.equal(r.status, 502);
    assert.ok(lines.every((l) => !l.includes(EMAIL) && cardRuns(l).length === 0));
  }
  fail = false;
  for (let i = 0; i < 2; i++) assert.equal((await sendContractEmail(req(), deps)).status, 200);

  const r = await sendContractEmail(req(), deps);
  assert.equal(r.status, 429);
  assert.match(r.message, /5 αποστολές/);
  assert.ok(r.retryAt);
  assert.equal(state.sent.length, 5);
  assert.equal(state.log.length, 5);
  assert.deepEqual(state.log.map((e) => e.ok), [false, false, false, true, true]);
  // Στο ιστορικό: μασκαρισμένο email, ποτέ το πλήρες.
  assert.ok(state.log.every((e) => e.to === "m***@example.com"));

  advance(60 * 60 * 1000);
  assert.equal((await sendContractEmail(req(), deps)).status, 200);
});

test("επιτυχία: email στον κύριο οδηγό, link, συνημμένο PDF, χωρίς αριθμό κάρτας", async () => {
  const { deps, state } = makeDeps();
  const { result: r, lines } = await captureErrors(() => sendContractEmail(req({ lang: "en" }), deps));
  assert.equal(r.status, 200);
  assert.equal(r.data.sentTo, EMAIL);
  assert.equal(r.data.lang, "en");
  assert.ok(!Number.isNaN(Date.parse(r.data.sentAt)));
  assert.equal(lines.length, 0);

  assert.equal(state.sent.length, 1);
  const m = state.sent[0];
  assert.equal(m.to, EMAIL);
  assert.equal(m.from, "onboarding@resend.dev");
  assert.match(m.subject, /^Your rental agreement C-7F3K9Q/);
  assert.ok(m.text.includes(`${ORIGIN}/c/${TOKEN}`));
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, "contract-C-7F3K9Q.pdf");
  const pdf = m.attachments[0].content;
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  // Χωρίς φωτογραφίες: μικρό αρχείο.
  assert.ok(pdf.length < 80 * 1024, `PDF ${pdf.length} bytes`);
  for (const s of [m.subject, m.text, m.html, pdf.toString("latin1")]) {
    assert.ok(!s.includes(PAN));
    assert.ok(!s.includes(PAN_SPACED));
  }
  assert.deepEqual(state.finished.map((f) => f.ok), [true]);
  assert.equal(state.finished[0].sentTo, EMAIL);
});

/* ─────────────────────────────────────────────
   PDF
   ───────────────────────────────────────────── */

test("PDF: ελληνικά, link αντί για QR, κάρτα μόνο •••• 1234, κανένας πλήρης αριθμός", async () => {
  const url = `${ORIGIN}/c/${TOKEN}`;
  const { bytes, texts } = await pdfTexts({ contract: makeContract(), url });
  const all = texts.join("\n").replace(/\u00a0/g, " ");

  // Ελληνικά (DejaVu) και τα βασικά στοιχεία του Α4.
  assert.ok(all.includes("Συμβόλαιο ενοικίασης / Rental agreement"));
  assert.ok(all.includes("Μαρία Παπαδοπούλου"));
  assert.ok(all.includes("ΧΝΗ 1234"));
  assert.ok(all.includes("Αεροδρόμιο Χανίων"));
  assert.ok(all.includes("Visa •••• 1111"));
  assert.ok(all.includes("Mastercard •••• 0004"));
  // Φωτογραφίες: μόνο πλήθος + σημείωση για το link.
  assert.ok(all.includes("Φωτογραφίες / Photos: 2"));
  assert.match(all, /φωτογραφίες ζημιών υπάρχουν στο online συμβόλαιο/);
  // Το link (μπορεί να σπάσει σε γραμμές) και όχι QR.
  assert.ok(texts.join("").includes(url));

  // ΚΑΝΕΝΑΣ αριθμός κάρτας (σημειώσεις, διεύθυνση, όροι), ούτε κάτοχος/λήξη.
  assert.deepEqual(cardRuns(all), []);
  assert.ok(!all.includes(PAN) && !all.includes(PAN_SPACED));
  assert.ok(all.includes("[•••]"));
  assert.ok(!all.includes("08/27") && !all.includes("MARIA P"));
  // Τηλέφωνο (10 ψηφία) μένει.
  assert.ok(all.includes("6912345678"));

  // Έγκυρο PDF, Α4, μικρό.
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.equal(Math.round(width), 595);
  assert.equal(Math.round(height), 842);
  assert.ok(bytes.length < 80 * 1024, `PDF ${bytes.length} bytes`);
});

test("PDF: πολύ μεγάλο κείμενο → νέες σελίδες, χωρίς σφάλμα", async () => {
  const c = makeContract({ notes: "Παρατήρηση με αρκετές λέξεις. ".repeat(400) });
  const { bytes } = await pdfTexts({ contract: c, url: `${ORIGIN}/c/${TOKEN}` });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 3);
});
