// tests/partner-commissions.test.mjs — «Προμήθειες συνεργατών» (Διαχειριστής /
// προσωπικό με «commission.partners»): ΙΔΙΟΣ υπολογισμός με τα «Οικονομικά»
// του συνεργάτη, δικαίωμα ατικάριστο από προεπιλογή, ποτέ σε συνεργάτη,
// εταιρία μόνο από το session.

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
const C = await import("../src/lib/commission.ts");
const F = await import("../src/lib/partnerFinance.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("δικαίωμα «commission.partners»: ατικάριστο για υπάρχοντες/νέους, ποτέ σε συνεργάτη, Διαχειριστής πάντα", () => {
  assert.ok(P.ALL_PERMISSIONS.includes("commission.partners"));
  assert.ok(!P.STAFF_DEFAULTS.includes("commission.partners"));
  assert.ok(!P.PARTNER_DEFAULTS.includes("commission.partners"));
  assert.equal(P.can("STAFF", P.defaultsForRole("STAFF"), "commission.partners"), false);
  assert.equal(P.can("STAFF", { "commission.partners": true }, "commission.partners"), true);
  assert.equal(P.can("COMPANY_ADMIN", {}, "commission.partners"), true);
  // Συνεργάτης: ποτέ, ακόμη κι αν το γράφει το JSON· η δική του προμήθεια μένει.
  assert.ok(P.PARTNER_NEVER.has("commission.partners"));
  assert.equal(P.can("PARTNER", { "commission.partners": true, "commission.view": true }, "commission.partners"), false);
  assert.equal(P.can("PARTNER", { "commission.view": true }, "commission.view"), true);
  // Στο παράθυρο δικαιωμάτων: φαίνεται στο προσωπικό, όχι στον συνεργάτη.
  const keys = (role) => P.groupsForRole(role).flatMap((g) => g.items.map((i) => i.key));
  assert.ok(keys("STAFF").includes("commission.partners"));
  assert.ok(!keys("PARTNER").includes("commission.partners") && keys("PARTNER").includes("commission.view"));
  const ui = read("src/app/(dashboard)/dashboard/users/UsersClient.tsx");
  assert.match(ui, /staffCommissionPartners: false,/);
  assert.match(ui, /data-testid="staff-access-commission-partners"/);
});

test("ΙΔΙΟΣ υπολογισμός με τα «Οικονομικά» του συνεργάτη (ίδιο select, μετατροπή, μήνας, ρυθμίσεις)", () => {
  const s = read("src/lib/partnerServer.ts");
  // Και οι τρεις φορτώσεις περνούν από τα ίδια κομμάτια.
  for (const fn of ["loadPartnerFinance", "loadPartnerCommissions", "loadPartnerCommissionDetail"]) {
    const body = s.slice(s.indexOf(`export async function ${fn}`), s.indexOf("\n}\n", s.indexOf(`export async function ${fn}`)));
    assert.match(body, /select: FINANCE_SELECT/, fn);
    assert.match(body, /\.\.\.pickupIn\(/, fn);
    assert.match(body, /partnerFinance\(/, fn);
    assert.match(body, /toFinanceInput/, fn);
  }
  // Οι ρυθμίσεις προμήθειας: η ΙΔΙΑ μετατροπή (commissionSettingsOf) για συνεργάτη και Διαχειριστή.
  assert.match(read("src/lib/listServer.ts"), /return commissionSettingsOf\(me\);/);
  assert.match(s, /const settings = commissionSettingsOf\(p\) \?\? NO_COMMISSION;/);
  assert.match(s, /const settings = commissionSettingsOf\(partner\) \?\? NO_COMMISSION;/);
  assert.deepEqual(C.commissionSettingsOf({ commissionRate: "20.00", commissionOnRental: true, commissionOnExtras: true, commissionOnInsurance: false }), { rate: 20, onRental: true, onExtras: true, onInsurance: false });
  assert.equal(C.commissionSettingsOf({ commissionRate: 0 }), null);
  // Ίδια ημερομηνία αναφοράς με τα «Οικονομικά».
  assert.match(read("src/app/(dashboard)/dashboard/partner-commissions/page.tsx"), /const month = currentMonth\(\);/);
  assert.match(read("src/app/(dashboard)/dashboard/partner/finance/page.tsx"), /const month = currentMonth\(\);/);
});

test("σύνολα: ακυρωμένες και με πλήρη επιστροφή δεν μετράνε· χωρίς κρατήσεις → μηδενικά", () => {
  const S = { rate: 20, onRental: true, onExtras: false, onInsurance: false };
  const row = (id, status, cents, sub, pay = "NONE") => ({ id, bookingNumber: id, pickupDate: "2026-11-05", returnDate: "2026-11-06", customer: "Π Π", status, paymentStatus: pay, totalCents: cents, subtotal: sub, extrasTotal: 0, insuranceCost: 0 });
  const r = F.partnerFinance([row("a", "CONFIRMED", 10000, 80), row("b", "CANCELLED", 50000, 400), row("c", "COMPLETED", 20000, 150, "REFUNDED")], S);
  assert.deepEqual(r.totals, { bookings: 1, totalCents: 10000, commissionCents: 1600 });
  assert.deepEqual(F.partnerFinance([], S).totals, { bookings: 0, totalCents: 0, commissionCents: 0 });
  // Οι συνεργάτες χωρίς κρατήσεις ΜΕΝΟΥΝ στη λίστα (map πάνω σε όλους τους συνεργάτες).
  assert.match(read("src/lib/partnerServer.ts"), /partnerFinance\(\(byPartner\.get\(p\.id\) \?\? \[\]\)\.map\(toFinanceInput\), settings\)/);
});

test("πρόσβαση και απομόνωση: φύλακας στον server, εταιρία ΜΟΝΟ από το session, συνεργάτης 403", () => {
  for (const f of ["src/app/api/partner-commissions/route.ts", "src/app/api/partner-commissions/[id]/route.ts"]) {
    const s = read(f);
    assert.match(s, /export const GET = withPermission\(/, f);
    assert.ok(s.trimEnd().endsWith('"commission.partners"\n);'), f);
    assert.match(s, /if \(!viewer\?\.tenantId \|\| viewer\.role === "PARTNER" \|\| viewer\.role === "SUPER_ADMIN"\) return forbidden\(\);/, f);
    assert.match(s, /viewer\.tenantId/, f);
    assert.doesNotMatch(s, /searchParams\.get\("tenant/, f);
  }
  const srv = read("src/lib/partnerServer.ts");
  assert.match(srv, /where: \{ tenantId, role: "PARTNER" \}/);
  assert.match(srv, /where: \{ tenantId, partnerId: \{ in: partners\.map\(\(p\) => p\.id\) \}, \.\.\.pickupIn\(range\) \}/);
  assert.match(srv, /db\.user\.findFirst\(\{ where: \{ id: partnerId, tenantId, role: "PARTNER" \}/);
  assert.match(read("src/app/(dashboard)/dashboard/partner-commissions/page.tsx"), /pageGuard\("commission\.partners"\);\s+if \(!guard \|\| isPartner\(guard\.viewer\)\) redirect/);
  // Τα «Οικονομικά» του συνεργάτη ΔΕΝ άλλαξαν συμπεριφορά: μόνο οι δικές του κρατήσεις.
  assert.match(srv, /const scope = bookingScope\(viewer\); \/\/ \{ tenantId, partnerId: ο ίδιος \}/);
});

/* ── Φίλτρο ημερών, PDF ── */

test("διάστημα: ακραίες ημέρες μετρούν, άκυρες ημερομηνίες/σειρά/μήκος → σφάλμα ΕΛ/EN", () => {
  const ok = F.parsePeriod({ from: "2026-11-05", to: "2026-11-07" });
  assert.deepEqual(ok, { ok: true, period: { kind: "days", from: "2026-11-05", to: "2026-11-07" } });
  const r = F.periodRange(ok.period);
  assert.equal(r.from.toISOString(), "2026-11-05T00:00:00.000Z");
  assert.equal(r.to.toISOString(), "2026-11-08T00:00:00.000Z", "το «Έως» περιλαμβάνεται: [05, 08)");
  // Μία ημέρα.
  assert.equal(F.periodRange(F.parsePeriod({ from: "2026-11-05", to: "2026-11-05" }).period).to.toISOString(), "2026-11-06T00:00:00.000Z");
  // Μήνας = ίδιο αποτέλεσμα με το φίλτρο μήνα των Οικονομικών (monthRange).
  const m = F.parsePeriod({ month: "2026-11" });
  assert.deepEqual(m.period, { kind: "month", month: "2026-11", from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(F.periodRange(m.period), F.monthRange("2026-11"));
  assert.deepEqual(F.parsePeriod({ month: "2026-02" }).period.to, "2026-02-28");
  assert.deepEqual(F.parsePeriod({}), { ok: true, period: { kind: "all" } });
  // Σφάλματα.
  for (const [q, err] of [
    [{ from: "2026-02-30", to: "2026-03-01" }, "invalid"],
    [{ from: "2026-11-05" }, "invalid"],
    [{ from: "x", to: "2026-11-05" }, "invalid"],
    [{ from: "2026-11-10", to: "2026-11-09" }, "order"],
    [{ from: "2026-01-01", to: "2027-01-02" }, "tooLong"],
    [{ month: "2026-13" }, "month"],
  ]) {
    assert.deepEqual(F.parsePeriod(q), { ok: false, error: err }, JSON.stringify(q));
    assert.ok(F.PERIOD_MESSAGES[err].el && F.PERIOD_MESSAGES[err].en);
  }
  assert.equal(F.parsePeriod({ from: "2026-01-01", to: "2027-01-01" }).ok, true, "366 ημέρες επιτρέπονται");
  // Τα «Οικονομικά» του συνεργάτη ΔΕΝ άλλαξαν: μόνο μήνας.
  assert.match(read("src/lib/partnerServer.ts"), /where: \{ \.\.\.scope, \.\.\.pickupIn\(month \? monthRange\(month\) : null\) \}/);
  assert.match(read("src/app/api/partner/finance/route.ts"), /if \(month && !monthRange\(month\)\) return badRequest/);
});

test("routes: ίδιος έλεγχος διαστήματος για λίστα, λεπτομέρεια, PDF· PDF με ίδια πρόσβαση + όριο", () => {
  for (const f of ["src/app/api/partner-commissions/route.ts", "src/app/api/partner-commissions/[id]/route.ts", "src/app/api/partner-commissions/pdf/route.ts"]) {
    const s = read(f);
    assert.match(s, /periodFromSearch\(/, f);
    assert.match(s, /if \(!p\.ok\) return badRequest\(p\.message\);/, f);
    assert.ok(s.trimEnd().endsWith('"commission.partners"\n);'), f);
    assert.match(s, /if \(!viewer\?\.tenantId \|\| viewer\.role === "PARTNER" \|\| viewer\.role === "SUPER_ADMIN"\) return forbidden\(\);/, f);
  }
  const pdf = read("src/app/api/partner-commissions/pdf/route.ts");
  assert.match(pdf, /hitLimit\(dbCounterStore, LIMITS\.commissionsPdfPerUser, viewer\.userId\)/);
  assert.match(pdf, /loadPartnerCommissions\(viewer\.tenantId, p\.period\)/);
  assert.match(pdf, /loadPartnerCommissionDetail\(viewer\.tenantId, partnerId, p\.period\)/);
  assert.match(pdf, /db\.tenant\.findUnique\(\{ where: \{ id: viewer\.tenantId \}, select: \{ name: true, brandColor: true, logoPath: true \} \}\)/);
  assert.match(pdf, /logo: await fetchLogoBytes\(tenant\.logoPath\),/);
  assert.match(pdf, /"Content-Disposition": `attachment; filename="\$\{filename\}"`/);
  // Λογότυπο: μόνο από το ιδιωτικό Storage της εταιρίας, με timeout/όριο, χωρίς URL στα logs.
  const logo = read("src/lib/invoiceServer.ts");
  assert.match(logo, /signal: AbortSignal\.timeout\(8000\)/);
  assert.match(logo, /buf\.length <= LOGO_MAX_BYTES/);
  assert.doesNotMatch(logo.slice(logo.indexOf("export async function fetchLogoBytes")), /console\.error\([^)]*url/);
});

test("PDF: χτίζεται με και χωρίς λογότυπο, για όλους/έναν, σελιδοποίηση, χωρίς στοιχεία πελάτη", async () => {
  const { buildCommissionsPdf, commissionsPdfFilename } = await import("../src/lib/partnerCommissionsPdf.ts");
  const { PDFDocument } = await import("pdf-lib");
  // 1×1 PNG
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
  const period = { kind: "days", from: "2026-11-01", to: "2026-11-30" };
  const partners = [{ id: "a", name: "Αλέξης Σ.", isActive: true, rate: 10, bookings: 2, totalCents: 30050, commissionCents: 2500 }];
  const totals = { bookings: 2, totalCents: 30050, commissionCents: 2500 };
  const base = { lang: "el", company: { name: "Εταιρία Δοκιμής", brandColor: "#2563EB" }, period, issuedAt: new Date("2026-11-05T10:00:00Z"), partners, totals };
  for (const logo of [png, null, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])]) {
    const bytes = await buildCommissionsPdf({ ...base, logo });
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  }
  // Ένας συνεργάτης με πολλές κρατήσεις → πολλές σελίδες.
  const items = Array.from({ length: 120 }, (_, i) => ({
    id: `b${i}`, bookingNumber: `BP-2026-${String(i).padStart(3, "0")}`, pickupDate: "2026-11-03", returnDate: "2026-11-05", customer: "Μαρία Παπαδάκη",
    status: i % 7 === 0 ? "CANCELLED" : "COMPLETED", refunded: false, totalCents: 18000, commissionCents: i % 7 === 0 ? 0 : 1500, counted: i % 7 !== 0,
  }));
  const many = await buildCommissionsPdf({ ...base, lang: "en", logo: null, bookings: items });
  assert.ok((await PDFDocument.load(many)).getPageCount() >= 3);
  assert.equal(commissionsPdfFilename(period), "promitheies-2026-11-01_2026-11-30.pdf");
  assert.equal(commissionsPdfFilename({ kind: "all" }), "promitheies-ola.pdf");
  // Από τον πελάτη ΜΟΝΟ ονοματεπώνυμο (κοινό select των Οικονομικών) — ποτέ επαφή/έγγραφο.
  const srv = read("src/lib/partnerServer.ts");
  const select = srv.slice(srv.indexOf("const FINANCE_SELECT = {"), srv.indexOf("} as const;", srv.indexOf("const FINANCE_SELECT = {")));
  assert.match(select, /customer: \{ select: \{ firstName: true, lastName: true \} \},/);
  assert.doesNotMatch(select, /email|phone|idNumber|license|address|dateOfBirth|vehicle/);
  assert.doesNotMatch(read("src/lib/partnerCommissionsPdf.ts"), /email|phone|idNumber/i);
  assert.match(read("src/lib/partnerCommissionsPdf.ts"), /\{ label: tr\("partner\.customer"\), w: 120 \},/);
});
