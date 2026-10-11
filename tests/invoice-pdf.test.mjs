// tests/invoice-pdf.test.mjs
// PDF τιμολογίου + αποστολή στον πελάτη: src/lib/invoiceCode.ts (τυχαίος
// κωδικός, επανάληψη σε P2002), src/lib/invoiceDocument.ts (γραμμές/ποσά),
// src/lib/invoicePdf.ts (pdf-lib, δύο γλώσσες, δεύτερη σελίδα, λογότυπο) και
// src/lib/invoiceEmailSend.ts (403/404/409/400/500/429/502/200 με mock Resend).
// Τρέχει με `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const {
  INVOICE_CODE_ALPHABET,
  INVOICE_CODE_MAX_ATTEMPTS,
  generateInvoiceCode,
  isInvoiceCode,
  isInvoiceCodeConflict,
  withInvoiceCode,
} = await import("../src/lib/invoiceCode.ts");
const { eurEl, invoiceLines, lineLabel, invoicePdfFilename, parseDocLang } = await import(
  "../src/lib/invoiceDocument.ts"
);
const { buildInvoicePdf } = await import("../src/lib/invoicePdf.ts");
const { invoiceEmailContent, classifyProviderError, INVOICE_EMAIL_MSG } = await import(
  "../src/lib/invoiceEmail.ts"
);
const { sendInvoiceEmail } = await import("../src/lib/invoiceEmailSend.ts");
const { PDFDocument } = await import("pdf-lib");

/* ─────────────────────────────────────────────
   Κωδικός τιμολογίου
   ───────────────────────────────────────────── */

test("κωδικός: μορφή XXXX-XXXX, μόνο από το αλφάβητο (χωρίς O, 0, I, 1)", () => {
  assert.equal(INVOICE_CODE_ALPHABET.length, 32);
  for (const ch of "O0I1") assert.ok(!INVOICE_CODE_ALPHABET.includes(ch));
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const code = generateInvoiceCode();
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    assert.ok(isInvoiceCode(code));
    seen.add(code);
  }
  // 32^8 ≈ 10^12 συνδυασμοί: 2000 κωδικοί δεν συμπίπτουν.
  assert.equal(seen.size, 2000);
  assert.equal(isInvoiceCode("INV-001"), false);
  assert.equal(isInvoiceCode("K7M2-X9PO"), false);
});

test("κωδικός: χρησιμοποιεί όλο το αλφάβητο μέσω της rand", () => {
  let n = 0;
  const code = generateInvoiceCode((max) => {
    assert.equal(max, 32);
    return n++ % max;
  });
  assert.equal(code, "ABCD-EFGH");
  assert.equal(generateInvoiceCode(() => 31), "9999-9999");
});

const p2002 = (target) => Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target } });

test("κωδικός: σε σύγκρουση unique ξαναδοκιμάζει με ΝΕΟ κωδικό", async () => {
  const tried = [];
  const result = await withInvoiceCode(async (code) => {
    tried.push(code);
    if (tried.length < 3) throw p2002(["invoiceCode"]);
    return `ok:${code}`;
  });
  assert.equal(tried.length, 3);
  assert.equal(new Set(tried).size, 3);
  assert.equal(result, `ok:${tried[2]}`);
});

test("κωδικός: έως 5 προσπάθειες, μετά πετά το σφάλμα", async () => {
  let calls = 0;
  await assert.rejects(
    withInvoiceCode(async () => {
      calls++;
      throw p2002("invoices_invoiceCode_key");
    }),
    (e) => e.code === "P2002"
  );
  assert.equal(calls, INVOICE_CODE_MAX_ATTEMPTS);
  assert.equal(INVOICE_CODE_MAX_ATTEMPTS, 5);
});

test("κωδικός: άλλα σφάλματα (και P2002 σε άλλο πεδίο) περνούν αμέσως", async () => {
  let calls = 0;
  await assert.rejects(
    withInvoiceCode(async () => {
      calls++;
      throw p2002(["tenantId", "invoiceNumber"]);
    })
  );
  assert.equal(calls, 1);
  assert.equal(isInvoiceCodeConflict(p2002(["bookingId"])), false);
  assert.equal(isInvoiceCodeConflict(new Error("x")), false);
  assert.equal(isInvoiceCodeConflict(p2002(["invoiceCode"])), true);
});

/* ─────────────────────────────────────────────
   Ποσά και γραμμές
   ───────────────────────────────────────────── */

test("ποσά σε ελληνική μορφή", () => {
  assert.equal(eurEl(1234.56), "1.234,56 €");
  assert.equal(eurEl(1234567.5), "1.234.567,50 €");
  assert.equal(eurEl(0), "0,00 €");
  assert.equal(eurEl(-15.5), "−15,50 €");
});

const extras = [
  { id: "e1", name: "GPS", price: 5, chargeType: "PER_DAY", type: "EXTRA", lineTotal: 25 },
  { id: "i1", name: "Πλήρης ασφάλεια", price: 10, chargeType: "PER_DAY", type: "INSURANCE", lineTotal: 50 },
];
const booking = {
  totalDays: 5,
  dailyRate: 40,
  subtotal: 200,
  extrasTotal: 25,
  insuranceCost: 50,
  discountAmount: 15,
  discountCode: "SUMMER",
  total: 260,
  extras,
};

test("γραμμές: ενοίκιο, πρόσθετο, ασφάλεια, έκπτωση — αθροίζουν στο σύνολο", () => {
  const lines = invoiceLines(booking, 260);
  assert.deepEqual(
    lines.map((l) => [l.kind, l.amount]),
    [
      ["rental", 200],
      ["extra", 25],
      ["insurance", 50],
      ["discount", -15],
    ]
  );
  assert.equal(lineLabel(lines[0], "el"), "Ενοίκιο οχήματος · 5 ημέρες × 40,00 €");
  assert.equal(lineLabel(lines[0], "en"), "Vehicle rental · 5 days × 40,00 €");
  assert.equal(lineLabel(lines[3], "el"), "Έκπτωση (SUMMER)");
});

test("γραμμές: χειροκίνητο ενοίκιο συμβολαίου (χωρίς ημερήσια τιμή)", () => {
  const lines = invoiceLines({ ...booking, total: 300 }, 300, 240);
  assert.equal(lines[0].amount, 240);
  assert.equal(lines[0].dailyRate, undefined);
  assert.equal(lineLabel(lines[0], "el"), "Ενοίκιο οχήματος · 5 ημέρες");
});

test("γραμμές: αν δεν συμφωνούν με το ΑΠΟΘΗΚΕΥΜΕΝΟ σύνολο → μία γραμμή με το σύνολο", () => {
  const lines = invoiceLines(booking, 999.99);
  assert.deepEqual(lines, [{ kind: "services", amount: 999.99 }]);
  assert.deepEqual(invoiceLines(null, 10), [{ kind: "services", amount: 10 }]);
});

test("γλώσσα και όνομα αρχείου", () => {
  assert.equal(parseDocLang(null), "el");
  assert.equal(parseDocLang("en"), "en");
  assert.equal(parseDocLang("de"), null);
  assert.equal(invoicePdfFilename("K7M2-X9PQ"), "Invoice-K7M2-X9PQ.pdf");
  assert.equal(invoicePdfFilename('../"x'), "Invoice-x.pdf");
});

/* ─────────────────────────────────────────────
   PDF
   ───────────────────────────────────────────── */

function makeDoc(over = {}) {
  return {
    code: "K7M2-X9PQ",
    issueDate: "2026-10-11",
    dueDate: "2026-11-10",
    paidAt: null,
    status: "UNPAID",
    company: {
      name: "Fleet-Pro Car Rental",
      vat: "123456789",
      taxOffice: "Α' Αθηνών",
      address: "Λεωφ. Συγγρού 100",
      region: "Αθήνα",
      phone: "+30 210 1234567",
      email: "info@fleetpro.example",
      iban: "GR1601101250000000012300695",
      brandColor: "#0F766E",
    },
    customer: { name: "Μαρία Παπαδοπούλου", address: "Ερμού 10, Αθήνα", phone: null, email: "maria@example.com" },
    booking: {
      number: "BP-2026-001",
      vehicle: "Toyota Yaris",
      plate: "ΙΚΤ-1234",
      pickupDate: "2026-10-01",
      pickupTime: "10:00",
      returnDate: "2026-10-06",
      returnTime: "09:30",
    },
    lines: invoiceLines(booking, 260),
    net: 209.68,
    vatRate: 24,
    vatAmount: 50.32,
    total: 260,
    ...over,
  };
}

/** Μικρό έγκυρο PNG 1×1. */
const PNG_1x1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC",
    "base64"
  )
);

test("PDF: ελληνικά και αγγλικά, έγκυρο αρχείο μίας σελίδας με τίτλο τον κωδικό", async () => {
  for (const lang of ["el", "en"]) {
    const bytes = await buildInvoicePdf({ doc: makeDoc(), lang, now: new Date("2026-10-11T10:00:00Z") });
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(pdf.getTitle(), `${lang === "el" ? "Τιμολόγιο" : "Invoice"} K7M2-X9PQ`);
  }
});

test("PDF: πολλές γραμμές → δεύτερη σελίδα", async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ kind: "extra", name: `Πρόσθετο ${i + 1}`, amount: 1 }));
  const pdf = await PDFDocument.load(await buildInvoicePdf({ doc: makeDoc({ lines: many }), lang: "el" }));
  assert.ok(pdf.getPageCount() >= 2);
});

test("PDF: λογότυπο PNG μπαίνει· άκυρα bytes/WebP → χωρίς λογότυπο, χωρίς σφάλμα", async () => {
  const plain = await buildInvoicePdf({ doc: makeDoc(), lang: "el" });
  const withLogo = await buildInvoicePdf({ doc: makeDoc(), lang: "el", logo: PNG_1x1 });
  const broken = await buildInvoicePdf({
    doc: makeDoc(),
    lang: "el",
    logo: Uint8Array.from(Buffer.from("RIFF0000WEBPVP8 junk")),
  });
  const badPng = await buildInvoicePdf({
    doc: makeDoc(),
    lang: "el",
    logo: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6]),
  });
  assert.ok(withLogo.length > plain.length);
  assert.ok(Math.abs(broken.length - plain.length) < 64);
  assert.ok(Math.abs(badPng.length - plain.length) < 64);
});

/* ─────────────────────────────────────────────
   Email
   ───────────────────────────────────────────── */

test("email: θέμα στη γλώσσα που επιλέχθηκε, χωρίς link", () => {
  const base = {
    companyName: "Fleet-Pro Car Rental",
    companyPhone: "+30 210 1234567",
    companyEmail: "info@fleetpro.example",
    code: "K7M2-X9PQ",
    customerName: "Μαρία",
    total: 1234.5,
    dueDate: "2026-11-10",
    status: "UNPAID",
  };
  const el = invoiceEmailContent({ ...base, lang: "el" });
  const en = invoiceEmailContent({ ...base, lang: "en" });
  assert.equal(el.subject, "Τιμολόγιο K7M2-X9PQ — Fleet-Pro Car Rental");
  assert.equal(en.subject, "Invoice K7M2-X9PQ — Fleet-Pro Car Rental");
  assert.equal(el.filename, "Invoice-K7M2-X9PQ.pdf");
  assert.match(el.text, /1\.234,50 €/);
  assert.match(el.text, /10\/11\/2026/);
  for (const c of [el, en]) {
    assert.doesNotMatch(c.text + c.html, /https?:|<a\s|href=/i);
  }
});

test("email: ταξινόμηση σφαλμάτων Resend (χωρίς να κρατά το μήνυμα)", () => {
  assert.equal(
    classifyProviderError({
      name: "validation_error",
      message: "You can only send testing emails to your own email address (owner@example.com).",
    }),
    "testing_only"
  );
  assert.equal(
    classifyProviderError({ name: "validation_error", message: "The example.com domain is not verified." }),
    "domain_unverified"
  );
  assert.equal(classifyProviderError({ name: "invalid_api_key", message: "x" }), "invalid_key");
  assert.equal(classifyProviderError({ name: "daily_quota_exceeded" }), "quota");
  assert.equal(classifyProviderError(new TypeError("fetch failed")), "send_failed");
});

const EMAIL = "maria@example.com";

function makeDeps(over = {}) {
  const state = { log: [], sent: [], finished: [] };
  const deps = {
    apiKey: "re_test",
    from: "billing@fleetpro.example",
    loadInvoice: async () => ({ doc: makeDoc(), customerEmail: EMAIL }),
    reserveAttempt: async (entry) => {
      if (state.log.length >= 5) return { ok: false, recent: state.log.length, retryAt: null };
      state.log.push(entry);
      return { ok: true, entry };
    },
    finishAttempt: async (id, o) => {
      state.finished.push({ id, ...o });
    },
    buildPdf: async (doc, lang) => buildInvoicePdf({ doc, lang }),
    send: async (_key, email) => {
      state.sent.push(email);
      return { error: null };
    },
    now: () => new Date("2026-10-11T12:00:00Z"),
    newId: () => `id-${state.log.length + 1}`,
    ...over,
  };
  return { deps, state };
}

const REQ = { role: "STAFF", userId: "u1", lang: "el" };

test("αποστολή: μόνο Διαχειριστής/Προσωπικό", async () => {
  const { deps, state } = makeDeps();
  const r = await sendInvoiceEmail({ ...REQ, role: "PARTNER" }, deps);
  assert.equal(r.status, 403);
  assert.equal(state.sent.length, 0);
  assert.equal((await sendInvoiceEmail({ ...REQ, role: "COMPANY_ADMIN" }, makeDeps().deps)).status, 200);
});

test("αποστολή: 404 (άλλη εταιρία), 409 (ακυρωμένο), 400 (χωρίς email)", async () => {
  assert.equal((await sendInvoiceEmail(REQ, makeDeps({ loadInvoice: async () => null }).deps)).status, 404);
  assert.equal(
    (await sendInvoiceEmail(REQ, makeDeps({ loadInvoice: async () => ({ doc: makeDoc({ status: "CANCELLED" }), customerEmail: EMAIL }) }).deps)).status,
    409
  );
  const r = await sendInvoiceEmail(REQ, makeDeps({ loadInvoice: async () => ({ doc: makeDoc(), customerEmail: null }) }).deps);
  assert.equal(r.status, 400);
  assert.equal(r.message, INVOICE_EMAIL_MSG.noEmail);
});

test("αποστολή: χωρίς RESEND_API_KEY → 500 και ΔΕΝ μετρά στο όριο", async () => {
  const { deps, state } = makeDeps({ apiKey: "" });
  const r = await sendInvoiceEmail(REQ, deps);
  assert.equal(r.status, 500);
  assert.equal(state.log.length, 0);
});

test("αποστολή: όριο 5 ανά ώρα → 429", async () => {
  const { deps } = makeDeps();
  for (let i = 0; i < 5; i++) assert.equal((await sendInvoiceEmail(REQ, deps)).status, 200);
  const r = await sendInvoiceEmail(REQ, deps);
  assert.equal(r.status, 429);
});

test("αποστολή: περιορισμός Resend (μόνο στο email του λογαριασμού) → διακριτό μήνυμα", async () => {
  const { deps, state } = makeDeps({ send: async () => ({ error: "testing_only" }) });
  const r = await sendInvoiceEmail(REQ, deps);
  assert.equal(r.status, 502);
  assert.equal(r.message, INVOICE_EMAIL_MSG.provider.testing_only);
  assert.deepEqual(
    state.finished.map((f) => [f.ok, f.error]),
    [[false, "testing_only"]]
  );
});

test("αποστολή: επιτυχία — PDF συνημμένο, reply-to της εταιρίας, θέμα στη γλώσσα", async () => {
  const { deps, state } = makeDeps();
  const r = await sendInvoiceEmail({ ...REQ, lang: "en" }, deps);
  assert.equal(r.status, 200);
  assert.equal(r.data.sentTo, EMAIL);
  const [mail] = state.sent;
  assert.equal(mail.to, EMAIL);
  assert.equal(mail.replyTo, "info@fleetpro.example");
  assert.equal(mail.subject, "Invoice K7M2-X9PQ — Fleet-Pro Car Rental");
  assert.equal(mail.attachments[0].filename, "Invoice-K7M2-X9PQ.pdf");
  assert.equal(mail.attachments[0].content.subarray(0, 5).toString(), "%PDF-");
  // Το ιστορικό κρατά μόνο μασκαρισμένο email.
  assert.equal(state.log[0].to, "m***@example.com");
  assert.deepEqual(state.finished.map((f) => [f.ok, f.sentTo]), [[true, EMAIL]]);
});

test("αποστολή: χωρίς email εταιρίας δεν μπαίνει reply-to", async () => {
  const doc = makeDoc();
  doc.company.email = null;
  const { deps, state } = makeDeps({ loadInvoice: async () => ({ doc, customerEmail: EMAIL }) });
  assert.equal((await sendInvoiceEmail(REQ, deps)).status, 200);
  assert.equal("replyTo" in state.sent[0], false);
});
