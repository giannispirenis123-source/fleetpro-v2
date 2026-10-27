// tests/price-integrity.test.mjs
// Ακεραιότητα ποσών προς τον πελάτη (PR price-integrity).
//
// Αφορμή: σε άλλο site ενοικίασης ένα email προς πελάτη έδειξε «180180»
// αντί για «180» — ο υπολογισμός ήταν σωστός, το ποσό τυπώθηκε δύο φορές.
// Εδώ: ΕΝΑΣ μορφοποιητής (money.ts), κάθε πρότυπο ΕΛ/EN με 0 / 180 /
// 1.180,50 / 12.345 €, έλεγχος πριν από ΚΑΘΕ αποστολή (verifyOutgoingAmounts),
// σπασμένο πρότυπο → μπλοκάρισμα, αναλλοίωτοι έλεγχοι στο quote, και
// «μητρώο» όλων των σημείων ώστε νέο σημείο να μην ξεχαστεί.
// Χωρίς βάση, χωρίς δίκτυο (το Resend είναι mock).

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const M = await import("../src/lib/public/money.ts");
const O = await import("../src/lib/public/outgoingAmounts.ts");
const BM = await import("../src/lib/bookingMessages.ts");
const { deliverEmail } = await import("../src/lib/bookingDecision.ts");
const { fill } = await import("../src/lib/storefront/i18n.ts");
const { invoiceEmailContent } = await import("../src/lib/invoiceEmail.ts");
const { emailContent } = await import("../src/lib/contractEmail.ts");
const { paymentStatusText } = await import("../src/lib/storefront/paymentText.ts").catch(() => ({}));
const { buildInvoicePdf } = await import("../src/lib/invoicePdf.ts");
const { quote, assertQuoteInvariants, QuoteInvariantError } = await import("../src/lib/public/pricing.ts");

const ROOT = new URL("../", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const NB = / /g;
const plain = (s) => s.replace(NB, " ");

/** Τα ποσά του ελέγχου: 0 €, 180 €, 1.180,50 €, 12.345 € (σε cents). */
const AMOUNTS = [0, 18000, 118050, 1234500];
const LANGS = ["el", "en"];

/* ── 1. Ο ΕΝΑΣ μορφοποιητής ── */

test("formatMoney: ΕΛ «180 €» / «1.180,50 €», EN «€180» / «€1,180.50», ίδιο σε κάθε μηχανή (χωρίς Intl)", () => {
  const cases = {
    el: ["0 €", "180 €", "1.180,50 €", "12.345 €"],
    en: ["€0", "€180", "€1,180.50", "€12,345"],
  };
  for (const lang of LANGS) {
    assert.deepEqual(AMOUNTS.map((c) => plain(M.formatMoney(c, lang))), cases[lang], lang);
  }
  assert.equal(M.formatMoney(18000, "el", { decimals: "always", plainSpace: true }), "180,00 €");
  assert.equal(M.formatMoney(-1550, "el", { plainSpace: true }), "−15,50 €");
  assert.equal(M.formatMoney(123456789, "el", { plainSpace: true }), "1.234.567,89 €");
  assert.equal(M.formatMoney(NaN, "el"), "—");
  assert.equal(M.formatMoney(Infinity, "en"), "—");
  assert.equal(M.formatEuros("1180.5", "el", { plainSpace: true }), "1.180,50 €");
  assert.equal(M.formatEuros(undefined, "el"), "—");
  assert.equal(M.storedTotalCents({ totalCents: 18000 }, "999"), 18000, "ΠΑΝΤΑ το αποθηκευμένο priceQuote");
  assert.equal(M.storedTotalCents(null, "180.00"), 18000);
});

test("fill: ΜΙΑ διέλευση — placeholder μέσα σε τιμή ΔΕΝ ξαναγεμίζει", () => {
  assert.equal(fill("Σύνολο: {amount}", { amount: "{amount}" }), "Σύνολο: {amount}");
  assert.equal(fill("{a}{b}", { a: "{b}", b: "x" }), "{b}x");
});

/* ── 2. Κάθε πρότυπο, ΕΛ και EN, με 0 / 180 / 1.180,50 / 12.345 ── */

const msgData = (kind, lang, totalCents, payment = null) => ({
  kind,
  lang,
  code: "AB12-CD34",
  firstName: "Μαρία",
  groupName: "Κατηγορία B",
  groupSimilar: "Fiat Panda",
  from: "2026-12-11T10:00",
  to: "2026-12-18T10:00",
  pickupLocation: "Αεροδρόμιο Χανίων",
  returnLocation: null,
  totalCents,
  insuranceName: null,
  company: { name: "Fleet-Pro Car Rental", phone: "+30 6912345678", email: "info@fleetpro.example" },
  bookingUrl: "https://example.test/s/fleet/el/booking/AB12-CD34",
  searchUrl: "https://example.test/s/fleet/el",
  reasonCode: "other",
  note: null,
  payment,
  paymentMethod: payment ? "ONLINE" : null,
});

const count = (hay, needle) => plain(hay).split(plain(needle)).length - 1;

test("μηνύματα κράτησης (επιβεβαίωση): το σύνολο ΑΚΡΙΒΩΣ μία φορά, ίσο με το αποθηκευμένο — ΕΛ/EN × 4 ποσά", () => {
  for (const lang of LANGS) {
    for (const total of AMOUNTS) {
      const m = BM.buildBookingMessage(msgData("confirm", lang, total));
      const f = M.formatMoney(total, lang);
      for (const body of [m.text, O.htmlToCheckText(m.html)]) {
        assert.equal(count(body, f), 1, `${lang} ${total}: «${f}»`);
        assert.equal(count(body, m.amounts.totalLine), 1);
        assert.ok(!body.includes("180180"), "180180");
      }
      assert.deepEqual(BM.checkBookingMessage(m), { ok: true }, `${lang} ${total}`);
      assert.equal(m.amounts.totalCents, total);
    }
  }
});

test("μηνύματα κράτησης με online πληρωμή / ακύρωση με επιστροφή: όλα τα ποσά από το αποθηκευμένο, ο έλεγχος περνά", () => {
  for (const lang of LANGS) {
    for (const total of AMOUNTS.filter((t) => t > 0)) {
      const paid = Math.round(total * 0.3);
      const confirm = BM.buildBookingMessage(msgData("confirm", lang, total, { paidCents: paid, refundedCents: 0 }));
      assert.deepEqual(BM.checkBookingMessage(confirm), { ok: true }, `confirm ${lang} ${total}`);
      assert.equal(count(confirm.text, confirm.amounts.totalLine), 1);
      const cancel = BM.buildBookingMessage(msgData("cancel", lang, total, { paidCents: paid, refundedCents: paid, retainedCents: 0 }));
      assert.deepEqual(BM.checkBookingMessage(cancel), { ok: true }, `cancel ${lang} ${total}`);
      assert.equal(cancel.amounts.totalLine, null);
      assert.ok(!cancel.text.includes("180180"));
    }
  }
});

test("email τιμολογίου ΕΛ/EN × 4 ποσά: το σύνολο μία φορά, στη φράση συνόλου", () => {
  for (const lang of LANGS) {
    for (const total of AMOUNTS) {
      const c = invoiceEmailContent({
        lang, companyName: "Fleet", companyPhone: "", companyEmail: "", code: "K7M2-X9PQ",
        customerName: "Μαρία", total: total / 100, dueDate: "2026-11-10", status: "UNPAID",
      });
      const f = M.formatMoney(total, "el", { decimals: "always", plainSpace: true });
      assert.equal(count(c.text, f), 1, `${lang} ${total}`);
      assert.equal(count(c.text, c.totalPhrase), 1);
      assert.ok(!c.text.includes("180180"));
      assert.deepEqual(O.verifyOutgoingAmounts([c.text, O.htmlToCheckText(c.html)], { totalCents: total, totalLine: c.totalPhrase }), { ok: true });
    }
  }
});

test("email συμβολαίου ΕΛ/EN: ΚΑΝΕΝΑ ποσό στο κείμενο (τα ποσά είναι στο PDF)", () => {
  for (const lang of LANGS) {
    const c = emailContent({
      lang, companyName: "Fleet", companyPhone: "+30 6918018012", companyEmail: "a@b.gr",
      contractNumber: "C-2026-001", customerName: "Μαρία", url: "https://example.test/c/abc", photoCount: 2,
    });
    assert.deepEqual(O.extractAmounts(c.text), [], lang);
    assert.deepEqual(O.verifyOutgoingAmounts([c.text, O.htmlToCheckText(c.html), c.subject], { totalCents: 0, totalLine: null }), { ok: true });
  }
});

/** Ένα ελάχιστο τιμολόγιο με ΜΙΑ γραμμή = σύνολο (και ΦΠΑ 24%). */
function invoiceDoc(totalCents) {
  const total = totalCents / 100;
  const vat = Math.round((total - total / 1.24) * 100) / 100;
  return {
    code: "K7M2-X9PQ", issueDate: "2026-10-11", dueDate: "2026-11-10", paidAt: null, status: "UNPAID",
    company: { name: "Fleet", vat: "1", taxOffice: "Α", address: "Α", region: "Α", phone: null, email: null, iban: null, brandColor: "#0F766E" },
    customer: { name: "Μαρία", address: null, phone: null, email: "m@example.com" },
    booking: null,
    lines: [{ kind: "services", amount: total }],
    net: Math.round((total - vat) * 100) / 100,
    vatRate: 24,
    vatAmount: vat,
    total,
  };
}

test("PDF τιμολογίου × 4 ποσά: βγαίνει μόνο αν τα ζωγραφισμένα ποσά = λογιστήριο (γραμμή = σύνολο επιτρέπεται)", async () => {
  for (const total of AMOUNTS) {
    const bytes = await buildInvoicePdf({ doc: invoiceDoc(total) });
    assert.ok(bytes.byteLength > 1000, String(total));
  }
});

test("PDF: διπλή εκτύπωση / κολλημένο ποσό / άγνωστο ποσό → AmountIntegrityError (ΚΑΝΕΝΑ PDF)", () => {
  const ok = O.verifyDrawnAmounts(["Ενοίκιο · 1 ημέρα × 180,00 €", "180,00 €", "Σύνολο", "180,00 €"], [18000, 18000, 18000], { storedCents: 18000, renderedCents: 18000 });
  assert.deepEqual(ok, { ok: true }, "ίδιο ποσό σε ΧΩΡΙΣΤΑ κελιά = σωστό");
  const twice = O.verifyDrawnAmounts(["Σύνολο", "180,00 €180,00 €"], [18000], { storedCents: 18000, renderedCents: 18000 });
  assert.equal(twice.code, "repeated_digits");
  const glued = O.verifyDrawnAmounts(["Σύνολο", "180180,00 €"], [18000], { storedCents: 18000, renderedCents: 18000 });
  assert.equal(glued.code, "repeated_digits");
  const extra = O.verifyDrawnAmounts(["Σύνολο", "180,00 €", "Σύνολο", "180,00 €"], [18000], { storedCents: 18000, renderedCents: 18000 });
  assert.equal(extra.code, "total_count");
  const mismatch = O.verifyDrawnAmounts(["Σύνολο", "190,00 €"], [19000], { storedCents: 18000, renderedCents: 19000 });
  assert.equal(mismatch.code, "unknown_amount");
  const huge = O.verifyDrawnAmounts(["Σύνολο", "99.999,00 €"], [9999900], { storedCents: 9999900, renderedCents: 9999900 });
  assert.equal(huge.code, "total_bounds");
  // Ελεύθερο κείμενο της εταιρίας χωρίς δεκαδικά («5 €/ημέρα») δεν μετρά.
  const named = O.verifyDrawnAmounts(["Πρόσθετο: Κάθισμα (5 €/ημέρα)", "35,00 €"], [3500], { storedCents: 3500, renderedCents: 3500 });
  assert.deepEqual(named, { ok: true });
  const e = new O.AmountIntegrityError("repeated_digits");
  assert.equal(e.message, "amount:repeated_digits");
});

/* ── 3. Σπασμένο πρότυπο → η αποστολή ΜΠΛΟΚΑΡΕΤΑΙ ── */

/** Ψεύτικες εξαρτήσεις αποστολής: το Resend είναι mock, τίποτα δεν φεύγει. */
function deps(message) {
  const calls = { send: [], record: [] };
  return {
    calls,
    apiKey: "re_test",
    from: "Fleet <a@b.c>",
    loadNotifications: async () => [],
    buildMessage: async () => ({ message, to: "maria@example.com", replyTo: null }),
    send: async (_k, e) => (calls.send.push(e), { error: null }),
    record: async (row) => void calls.record.push(row),
  };
}

/** Ένα «σπασμένο» fill δύο διελεύσεων (το είδος σφάλματος του περιστατικού). */
const doublePassFill = (template, values) => fill(fill(template, values) + "{amount}", values);

test("σπασμένο πρότυπο (διπλή διέλευση) → η αποστολή μπλοκάρεται, καταγράφεται με κωδικό, ΔΕΝ καλείται το Resend", async () => {
  const good = BM.buildBookingMessage(msgData("confirm", "el", 18000));
  const brokenLine = doublePassFill("Σύνολο: {amount}", { amount: M.formatMoney(18000, "el") });
  assert.equal(plain(brokenLine), "Σύνολο: 180 €180 €");
  const broken = {
    ...good,
    text: good.text.replace(good.amounts.totalLine, brokenLine),
    html: good.html.replace(good.amounts.totalLine, brokenLine),
  };
  assert.equal(BM.checkBookingMessage(broken).ok, false);
  const d = deps(broken);
  const r = await deliverEmail("confirm", d);
  assert.equal(r.email, "blocked");
  assert.equal(d.calls.send.length, 0, "ΤΙΠΟΤΑ δεν στάλθηκε");
  assert.equal(d.calls.record.length, 1);
  assert.equal(d.calls.record[0].result, "blocked");
  assert.match(d.calls.record[0].error, /^amount:(repeated_digits|total_count|unknown_amount)$/);
  assert.equal(d.calls.record[0].amountCents, 18000);
  // Ο Διαχειριστής μπορεί να το στείλει ΡΗΤΑ (force) — καταγράφεται ως forced.
  const f = deps(broken);
  const forced = await deliverEmail("confirm", f, { force: true });
  assert.equal(forced.email, "sent");
  assert.match(f.calls.record[0].error, /^forced:/);
  // Το σωστό μήνυμα φεύγει κανονικά, με το ποσό στο ιστορικό.
  const g = deps(good);
  assert.equal((await deliverEmail("confirm", g)).email, "sent");
  assert.equal(g.calls.send.length, 1);
  assert.deepEqual({ result: g.calls.record[0].result, amountCents: g.calls.record[0].amountCents }, { result: "sent", amountCents: 18000 });
});

test("ΠΕΡΙΣΤΑΤΙΚΟ «180180»: ποσό τυπωμένο δύο φορές σε email πελάτη → ΔΕΝ στέλνεται (regression)", async () => {
  // Ακριβώς το σύμπτωμα: σωστός υπολογισμός (180 €), λάθος εμφάνιση (180180).
  const good = BM.buildBookingMessage(msgData("confirm", "el", 18000));
  for (const symptom of ["Σύνολο: 180180 €", "Σύνολο: 180180", "Σύνολο: 180 €180 €", "Σύνολο: 180 €180 €"]) {
    const broken = { ...good, text: good.text.replace(good.amounts.totalLine, symptom), html: good.html.replace(good.amounts.totalLine, symptom) };
    const check = BM.checkBookingMessage(broken);
    assert.equal(check.ok, false, symptom);
    const d = deps(broken);
    assert.equal((await deliverEmail("confirm", d)).email, "blocked", symptom);
    assert.equal(d.calls.send.length, 0);
  }
  // Και στα αγγλικά.
  const en = BM.buildBookingMessage(msgData("confirm", "en", 18000));
  const brokenEn = { ...en, text: en.text.replace(en.amounts.totalLine, "Total: €180180") };
  assert.equal(BM.checkBookingMessage(brokenEn).ok, false);
  // Τηλέφωνο που ΠΕΡΙΕΧΕΙ «180180» (6918018012) δεν είναι ποσό — όχι ψευδής συναγερμός.
  const phone = BM.buildBookingMessage({ ...msgData("confirm", "el", 18000), company: { name: "Fleet", phone: "+30 6918018012", email: null } });
  assert.ok(phone.text.includes("6918018012"));
  assert.deepEqual(BM.checkBookingMessage(phone), { ok: true });
});

test("έλεγχος ποσών: κάθε κανόνας (α)–(δ)", () => {
  const spec = { totalCents: 18000, otherCents: [5400], totalLine: "Σύνολο: 180 €" };
  const base = "Γεια\nΣύνολο: 180 €\nΠληρώθηκαν online: 54 €";
  assert.deepEqual(O.verifyOutgoingAmounts(base, spec), { ok: true });
  assert.equal(O.verifyOutgoingAmounts(base + "\nΈκπτωση 99 €", spec).code, "unknown_amount", "(α) άγνωστο ποσό");
  assert.equal(O.verifyOutgoingAmounts(base + "\nΣύνολο: 180 €", spec).code, "total_count", "(β) σύνολο δύο φορές");
  assert.equal(O.verifyOutgoingAmounts("Γεια", spec).code, "total_count", "(β) χωρίς γραμμή συνόλου");
  assert.equal(O.verifyOutgoingAmounts("Σύνολο: 180 €180 €", spec).code, "repeated_digits", "(γ)");
  assert.equal(O.verifyOutgoingAmounts("Σύνολο: 180180 €", spec).code, "repeated_digits", "(γ)");
  assert.equal(O.verifyOutgoingAmounts(base, { ...spec, totalCents: -100 }).code, "total_bounds", "(δ) αρνητικό");
  assert.equal(O.verifyOutgoingAmounts(base, { ...spec, totalCents: M.MAX_TOTAL_CENTS + 1 }).code, "total_bounds", "(δ) πάνω από το όριο");
  assert.equal(O.verifyOutgoingAmounts(base, { ...spec, totalCents: NaN }).code, "bad_total");
  // Ημερομηνίες «22 Δεκ» και ώρες δεν είναι ποσά.
  assert.deepEqual(O.verifyOutgoingAmounts(base + "\nΠαρ 22 Δεκ 2026, 10:00", { ...spec, otherCents: [5400, 200] }), { ok: true });
});

/* ── 4. Αναλλοίωτοι έλεγχοι στο quote ── */

test("quote: σύνολο = άθροισμα γραμμών, όχι NaN/αρνητικό, όχι πάνω από το όριο — αλλιώς ΣΦΑΛΜΑ", () => {
  assert.doesNotThrow(() => assertQuoteInvariants([{ totalCents: 15000 }, { totalCents: 3000 }], 18000));
  assert.throws(() => assertQuoteInvariants([{ totalCents: 15000 }], 18000), (e) => e instanceof QuoteInvariantError && e.code === "sum_mismatch");
  assert.throws(() => assertQuoteInvariants([{ totalCents: NaN }], NaN), (e) => e.code === "nan");
  assert.throws(() => assertQuoteInvariants([{ totalCents: -100 }], -100), (e) => e.code === "negative");
  assert.throws(() => assertQuoteInvariants([{ totalCents: M.MAX_TOTAL_CENTS + 100 }], M.MAX_TOTAL_CENTS + 100), (e) => e.code === "too_large");
  // Η quote() καλεί τον έλεγχο ΠΡΙΝ επιστρέψει (καμία αλλαγή στη λογική τιμής).
  const src = read("src/lib/public/pricing.ts");
  assert.ok(src.indexOf("assertQuoteInvariants(lines, totalCents);") < src.indexOf("    avgDailyCents: perDayOf(totalCents, days).cents,"));
  assert.equal(typeof quote, "function");
});

/* ── 5. Μητρώο σημείων: ΚΑΘΕ ποσό προς πελάτη από το ΕΝΑ formatMoney, ΚΑΘΕ αποστολή με έλεγχο ── */

/**
 * Τα σημεία του Βήματος 1 — από πού έρχεται το ποσό και πώς μορφοποιείται.
 * Νέο σημείο = νέα γραμμή εδώ (το επόμενο test αποτυγχάνει αν ξεχαστεί).
 */
const AMOUNT_POINTS = {
  "src/lib/bookingMessages.ts": "email/WhatsApp/mailto επιβεβαίωσης & ακύρωσης — priceQuote.totalCents + πληρωμές → formatMoney",
  "src/lib/invoiceEmail.ts": "email τιμολογίου — invoices.total → eurEl → formatEuros",
  "src/lib/invoiceDocument.ts": "γραμμές τιμολογίου — αποθηκευμένα ποσά → eurEl → formatEuros",
  "src/lib/invoicePdf.ts": "PDF τιμολογίου — λογιστήριο (amountLedger) + verifyDrawnAmounts",
  "src/lib/contractPdf.ts": "PDF συμβολαίου — snapshot → λογιστήριο + verifyDrawnAmounts",
  "src/components/contracts/ContractDocument.tsx": "σελίδα /c/ και εκτύπωση συμβολαίου — snapshot → formatEuros",
  "src/components/storefront/StorefrontViews.tsx": "σελίδα /booking/ΚΩΔΙΚΟΣ, φόρμα & quote του site — priceQuote → formatCents/formatEuro",
  "src/lib/storefront/paymentText.ts": "κείμενα πληρωμής του site — booking_payments → formatCents",
  "src/lib/storefront/i18n.ts": "formatEuro του site → formatEuros",
  "src/lib/public/paymentServer.ts": "Stripe Checkout (unit_amount σε cents, κανένα ποσό σε κείμενο) + ειδοποιήσεις dashboard → formatMoney",
  "src/lib/contractPayment.ts": "Stripe Checkout συμβολαίου — unit_amount σε cents, κανένα ποσό σε κείμενο",
  "src/lib/public/payments.ts": "μηνύματα επιστροφής χρημάτων (dashboard) → formatMoney",
  "src/app/(dashboard)/dashboard/bookings/BookingDecision.tsx": "κάρτα κράτησης: προεπισκόπηση, WhatsApp/mailto, ιστορικό αποστολών → formatCents + checkBookingMessage",
  "src/app/(dashboard)/dashboard/bookings/BookingsClient.tsx": "λίστα/κάρτα κρατήσεων (dashboard) → formatEuros",
};

function srcFiles(dir = join(ROOT, "src")) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return srcFiles(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

test("μητρώο: κάθε σημείο υπάρχει και μορφοποιεί ΜΟΝΟ μέσω money.ts", () => {
  for (const f of Object.keys(AMOUNT_POINTS)) {
    const s = read(f);
    assert.match(s, /formatMoney|formatCents|formatEuros|formatEuro\b|eurEl|amountLedger|unit_amount/, f);
  }
});

test("κανένας άλλος μορφοποιητής ποσών στον κώδικα (Intl currency / toFixed + €) εκτός του money.ts", () => {
  const offenders = [];
  for (const f of srcFiles()) {
    const rel = relative(ROOT, f);
    if (rel === "src/lib/public/money.ts") continue;
    const s = readFileSync(f, "utf8");
    if (/style:\s*"currency"/.test(s)) offenders.push(`${rel}: Intl currency`);
    if (/toFixed\(2\)[^\n]*€|€[^\n]*toFixed\(2\)/.test(s)) offenders.push(`${rel}: toFixed + €`);
    if (/`[^`\n]*\$\{[^}]*\}\s*€`/.test(s) && /cents|amount|total|price/i.test(s)) {
      // template string που κολλάει «€» σε μεταβλητή — μόνο μέσω formatMoney.
      offenders.push(`${rel}: \${…} €`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("κάθε αποστολή προς πελάτη περνά από τον έλεγχο ποσών (νέος αποστολέας χωρίς έλεγχο → αποτυχία)", () => {
  // Αποστολείς: όποιο αρχείο στέλνει email (Resend), φτιάχνει WhatsApp/mailto ή PDF.
  const senders = srcFiles()
    .map((f) => relative(ROOT, f))
    .filter((rel) => /new Resend\(|emails\.send\(|whatsappLink\(|mailtoLink\(|buildInvoicePdf\(|buildContractPdf\(/.test(read(rel)));
  /** Πού γίνεται ο έλεγχος για κάθε αποστολέα. */
  const GUARD = {
    "src/lib/bookingDecisionServer.ts": ["src/lib/bookingDecision.ts", /checkBookingMessage\(message\)/],
    "src/lib/bookingMessages.ts": ["src/lib/bookingMessages.ts", /export function checkBookingMessage/],
    "src/app/(dashboard)/dashboard/bookings/BookingDecision.tsx": ["src/app/(dashboard)/dashboard/bookings/BookingDecision.tsx", /checkBookingMessage\(message\)/],
    "src/app/api/invoices/[id]/email/route.ts": ["src/lib/invoiceEmailSend.ts", /verifyOutgoingAmounts\(\[content\.text/],
    "src/app/api/invoices/[id]/pdf/route.ts": ["src/lib/invoicePdf.ts", /verifyDrawnAmounts\(drawnMoney/],
    "src/app/api/contracts/[id]/email/route.ts": ["src/lib/contractEmailSend.ts", /verifyOutgoingAmounts\(\[content\.text/],
    "src/lib/invoicePdf.ts": ["src/lib/invoicePdf.ts", /throw new AmountIntegrityError/],
    "src/lib/contractPdf.ts": ["src/lib/contractPdf.ts", /throw new AmountIntegrityError/],
    // Email εγγραφής: ΚΑΝΕΝΑ ποσό (ελέγχεται παρακάτω).
    "src/lib/signup/mailer.ts": ["src/lib/signup/signup.ts", /verificationEmail/],
  };
  assert.deepEqual(senders.filter((s) => !(s in GUARD)), [], "νέος αποστολέας χωρίς έλεγχο ποσών");
  for (const [sender, [file, re]] of Object.entries(GUARD)) {
    assert.ok(senders.includes(sender), `${sender}: δεν είναι πια αποστολέας — βγάλ' τον από τη λίστα`);
    assert.match(read(file), re, `${sender} → ${file}`);
  }
  // deliverEmail: ο έλεγχος ΠΡΙΝ από το send.
  const d = read("src/lib/bookingDecision.ts");
  assert.ok(d.indexOf("checkBookingMessage(message)") < d.indexOf("await deps.send(apiKey"));
  // WhatsApp/mailto ΜΟΝΟ όταν περνά ο έλεγχος ή μετά από ρητή επιβεβαίωση.
  const ui = read("src/app/(dashboard)/dashboard/bookings/BookingDecision.tsx");
  assert.match(ui, /const allowed = \(check\?\.ok \?\? false\) \|\| override;/);
  assert.match(ui, /message && info && allowed \? whatsappLink\(/);
  // Παράκαμψη email: ΜΟΝΟ Διαχειριστής, ελεγμένο στον server.
  assert.match(read("src/app/api/bookings/[id]/email/route.ts"), /if \(force && v\.role !== "COMPANY_ADMIN"\) return forbidden/);
});

test("email εγγραφής: κανένα ποσό", async () => {
  const S = await import("../src/lib/signup/signup.ts");
  for (const lang of LANGS) {
    const v = S.verificationEmail(lang, "a@b.gr", "Μαρία", "https://x.test/verify?token=180180");
    assert.deepEqual(O.extractAmounts(v.text), []);
  }
});

test("SQL 38: μόνο προσθήκη στήλης + 'blocked' στον CHECK, idempotent, με verification", () => {
  const sql = read("prisma/sql/38-outgoing-amounts.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "amountCents" INTEGER;/);
  assert.match(sql, /CHECK \("result" IN \('sent', 'failed', 'opened', 'blocked'\)\)/);
  assert.match(sql, /NOT LIKE '%blocked%'/);
  assert.doesNotMatch(sql, /DELETE FROM|DROP TABLE|DROP COLUMN/);
  assert.match(sql, /-- Verification/);
});
