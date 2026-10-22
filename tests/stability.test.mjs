// tests/stability.test.mjs
// Σταθερότητα (audit): error boundaries χωρίς διαρροή, timeouts με ήπια
// αποτυχία στις εξωτερικές κλήσεις, σελιδοποίηση στον server (όρια, σειρά,
// σύνολα, εταιρία). Χωρίς βάση. Τρέχει με `npm test`.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const ROOT = new URL("../", import.meta.url).pathname;
const src = (p) => readFileSync(ROOT + p, "utf8");
const code = (p) => src(p).split("\n").filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join("\n");

/* ─────────────────────────────────────────────
   1. error.tsx
   ───────────────────────────────────────────── */

const BOUNDARIES = [
  "src/app/global-error.tsx",
  "src/app/error.tsx",
  "src/app/(dashboard)/dashboard/error.tsx",
  "src/app/(storefront)/s/[slug]/error.tsx",
  "src/app/(public)/c/[token]/error.tsx",
  "src/app/(super-admin)/super-admin/error.tsx",
];

test("error boundaries σε ρίζα, dashboard, site, /c/, super-admin (+ global-error με δικό του html)", () => {
  for (const f of BOUNDARIES) {
    assert.ok(existsSync(ROOT + f), f);
    const s = code(f);
    assert.match(s, /^"use client";/, f);
    assert.match(s, /<ErrorScreen[\s\S]*digest=\{error\.digest\}[\s\S]*onRetry=\{reset\}/, f);
    // ΠΟΤΕ μήνυμα/stack/αιτία του σφάλματος στην οθόνη ή στο console του browser.
    assert.doesNotMatch(s, /error\.(message|stack|cause|name)|console\./, f);
  }
  assert.match(src("src/app/global-error.tsx"), /<html lang="el">[\s\S]*<body/);
  assert.ok(existsSync(ROOT + "src/app/(dashboard)/dashboard/loading.tsx"));
});

test("ErrorScreen: μόνο digest (έγκυρης μορφής), «Δοκιμάστε ξανά», σύνδεσμος επιστροφής, ΕΛ/EN", async () => {
  const s = code("src/components/errors/ErrorScreen.tsx");
  assert.doesNotMatch(s, /\.message|\.stack|dangerouslySetInnerHTML/);
  assert.match(s, /Δοκιμάστε ξανά/);
  assert.match(s, /Try again/);
  assert.match(s, /<a\s+href=\{back\.href\}/);
  // Κωδικός digest: μόνο σύντομο hash, τίποτα που μοιάζει με μήνυμα.
  const { safeDigest } = await import("../src/components/errors/digest.ts");
  assert.match(s, /const code = safeDigest\(digest\);/);
  assert.equal(safeDigest("1234567890"), "1234567890");
  assert.equal(safeDigest("Error: customer john@x.gr not found"), null);
  assert.equal(safeDigest(undefined), null);
});

test("site: γλώσσα από το URL, επιστροφή μόνο σε έγκυρο slug· /c/: μόνο στην ίδια σελίδα", () => {
  const site = code("src/app/(storefront)/s/[slug]/error.tsx");
  assert.match(site, /\/\^\[a-z0-9-\]\{1,60\}\$\/\.test\(slug\)/);
  assert.match(site, /lang === "el" \? "el" : lang === "en" \? "en" : "both"/);
  const c = code("src/app/(public)/c/[token]/error.tsx");
  assert.match(c, /\/\^\\\/c\\\/\[A-Za-z0-9_-\]\+\$\/\.test\(path\)/);
  assert.match(c, /lang="both"/);
});

/* ─────────────────────────────────────────────
   2. Timeouts — ήπια αποτυχία
   ───────────────────────────────────────────── */

const { withTimeout, TimeoutError, TIMEOUTS } = await import("../src/lib/withTimeout.ts");
const { fetchGooglePlace } = await import("../src/lib/public/reviews.ts");

test("withTimeout: γρήγορη απάντηση περνά, αργή → TimeoutError (χωρίς να κρεμάσει)", async () => {
  assert.equal(await withTimeout(Promise.resolve(42), 50), 42);
  const t0 = Date.now();
  await assert.rejects(withTimeout(new Promise((r) => setTimeout(() => r(1), 500)), 30, "email"), (e) => e instanceof TimeoutError && e.name === "TimeoutError");
  assert.ok(Date.now() - t0 < 300);
  // Σφάλμα του ίδιου του παρόχου περνά όπως είναι.
  await assert.rejects(withTimeout(Promise.reject(new Error("x")), 50), /x/);
  assert.deepEqual({ google: TIMEOUTS.google, email: TIMEOUTS.email, stripe: TIMEOUTS.stripe }, { google: 5000, email: 10000, stripe: 10000 });
});

test("Google Places: AbortSignal 5΄΄· timeout/σφάλμα/μη-200 → null (η σελίδα φορτώνει χωρίς κριτικές)", async () => {
  const PLACE = "ChIJN1t_tDeuEmsRUsoyG83frY4";
  let seen = null;
  const aborting = async (_url, init) => {
    seen = init.signal;
    const e = new Error("The operation was aborted due to timeout");
    e.name = "TimeoutError";
    throw e;
  };
  const errLog = console.error;
  console.error = () => {};
  try {
    assert.equal(await fetchGooglePlace(PLACE, "el", { apiKey: "k", fetch: aborting }), null);
    assert.ok(seen instanceof AbortSignal, "περνά signal στο fetch");
    assert.equal(await fetchGooglePlace(PLACE, "el", { apiKey: "k", fetch: async () => ({ ok: false, json: async () => ({}) }) }), null);
    // Πραγματικό αργό fetch που σέβεται το signal: τερματίζει στο όριο.
    const slow = (_u, init) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
    const t0 = Date.now();
    const r = await Promise.race([fetchGooglePlace(PLACE, "el", { apiKey: "k", fetch: slow }), new Promise((res) => setTimeout(() => res("hang"), 7000))]);
    assert.equal(r, null);
    assert.ok(Date.now() - t0 >= 4500 && Date.now() - t0 < 6500, "κόβεται στα ~5΄΄");
  } finally {
    console.error = errLog;
  }
  // Και η cache του server πέφτει σε null, όχι σε 500.
  assert.match(src("src/lib/public/placesServer.ts"), /cachedGooglePlace\(id, lang\)\.catch\(\(\) => null\)/);
});

test("Resend: κάθε αποστολή με όριο 10΄΄ και ήπια αποτυχία (σφάλμα → κωδικός, όχι 500)", () => {
  for (const f of ["src/app/api/invoices/[id]/email/route.ts", "src/app/api/contracts/[id]/email/route.ts", "src/lib/bookingDecisionServer.ts"]) {
    const s = src(f);
    assert.match(s, /await withTimeout\(new Resend\(apiKey\)\.emails\.send\(email\), TIMEOUTS\.email, "email"\);/, f);
    assert.doesNotMatch(s.replace(/withTimeout\(new Resend/g, ""), /new Resend\(apiKey\)\.emails\.send/, f);
    assert.match(s, /\} catch \(e\) \{\s*return \{ error: \w+\(e\) \};/, f);
  }
});

test("Stripe: κοινός client με όριο 10΄΄ + 1 επανάληψη· checkout 8΄΄· σαφή μηνύματα σε αποτυχία", () => {
  const c = src("src/lib/stripeConnect.ts");
  assert.match(c, /new Stripe\(key, \{ apiVersion: "2023-10-16", maxNetworkRetries: 1, timeout: TIMEOUTS\.stripe \}\)/);
  assert.match(src("src/lib/public/paymentServer.ts"), /timeout: 8_000, maxNetworkRetries: 1/);
  assert.match(src("src/lib/contractPayment.ts"), /timeout: 8_000/);
  for (const f of ["src/app/api/bookings/[id]/payment-check/route.ts", "src/app/api/contracts/[id]/payment/check/route.ts", "src/app/api/public-site/payments/connect/route.ts", "src/app/api/public-site/payments/login-link/route.ts"]) {
    assert.match(src(f), /Το Stripe δεν απάντησε\. Δοκιμάστε ξανά σε λίγο\./, f);
  }
  assert.match(src("src/app/api/bookings/[id]/refund/route.ts"), /REFUND_MSG\.stripe/);
});

test("Supabase Storage: όριο σε κάθε κλήση· αργή υπογραφή → σελίδα χωρίς εικόνα", () => {
  const s = src("src/lib/storage.ts");
  assert.equal((s.match(/signal: AbortSignal\.timeout\(TIMEOUTS\.storage(Sign|Remove|Upload)\)/g) ?? []).length, 3);
  assert.equal((s.match(/await fetch\(/g) ?? []).length, 3);
});

/* ─────────────────────────────────────────────
   3. Σελιδοποίηση
   ───────────────────────────────────────────── */

const P = await import("../src/lib/pagination.ts");
const Q = await import("../src/lib/listQueries.ts");
const { effectiveStatus } = await import("../src/lib/invoices.ts");

/** Μικρός «Prisma» στη μνήμη για τα where/orderBy που φτιάχνει το listQueries. */
function matches(row, where) {
  for (const [k, cond] of Object.entries(where)) {
    if (k === "AND") { if (!cond.every((c) => matches(row, c))) return false; continue; }
    if (k === "OR") { if (!cond.some((c) => matches(row, c))) return false; continue; }
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("contains" in cond) {
        const hay = String(v ?? "");
        if (!(cond.mode === "insensitive" ? hay.toLowerCase().includes(cond.contains.toLowerCase()) : hay.includes(cond.contains))) return false;
      } else if ("in" in cond) { if (!cond.in.includes(v)) return false; }
      else if ("lt" in cond) { if (!(v < cond.lt)) return false; }
      else if (!matches(v ?? {}, cond)) return false; // σχέση (customer/vehicle/booking)
    } else if (v !== cond) return false;
  }
  return true;
}
function query(rows, { where, orderBy, skip, take }) {
  const cmp = (a, b) => {
    for (const o of orderBy) {
      const [k, dir] = Object.entries(o)[0];
      const x = a[k] instanceof Date ? a[k].getTime() : a[k];
      const y = b[k] instanceof Date ? b[k].getTime() : b[k];
      if (x < y) return dir === "asc" ? -1 : 1;
      if (x > y) return dir === "asc" ? 1 : -1;
    }
    return 0;
  };
  const all = rows.filter((r) => matches(r, where)).sort(cmp);
  return { total: all.length, items: all.slice(skip, skip + take) };
}
const pages = (rows, where, orderBy) => {
  const out = [];
  let total = 0;
  for (let p = 1; p < 50; p++) {
    const r = query(rows, { where, orderBy, ...P.pageWindow(p) });
    total = r.total;
    if (r.items.length === 0) break;
    out.push(r.items);
  }
  return { out, total };
};

test("σελίδα: όρια, άκυρες τιμές, ανώτατο μέγεθος", () => {
  assert.equal(P.LIST_PAGE_SIZE, 50);
  for (const [raw, exp] of [[undefined, 1], ["", 1], ["abc", 1], ["-3", 1], ["0", 1], ["2", 2], ["2.9", 2], [7, 7], ["99999999", P.LIST_MAX_PAGE]]) {
    assert.equal(P.parsePage(raw), exp, String(raw));
  }
  assert.deepEqual(P.pageWindow(1), { skip: 0, take: 50 });
  assert.deepEqual(P.pageWindow(3), { skip: 100, take: 50 });
  assert.deepEqual(P.pageWindow(2, 1000), { skip: 100, take: 100 }, "ποτέ πάνω από 100 ανά αίτημα");
  assert.equal(P.pageCount(0, 50), 1);
  assert.equal(P.pageCount(101, 50), 3);
  assert.deepEqual(P.searchWords("  Νίκος   ΧΑΝ-12 "), ["Νίκος", "ΧΑΝ-12"]);
  assert.equal(P.searchWords("a b c d e f g").length, 5);
});

// 137 κρατήσεις της Α (μερικές με ίδιο createdAt) + 20 της Β.
const T0 = Date.parse("2026-01-01T00:00:00Z");
const STATUSES = ["PENDING", "CONFIRMED", "ACTIVE", "COMPLETED", "CANCELLED"];
const bookings = [
  ...Array.from({ length: 137 }, (_, i) => ({
    id: `a${String(i).padStart(3, "0")}`,
    tenantId: "A",
    status: STATUSES[i % 5],
    createdById: i % 3 === 0 ? "u1" : "u2",
    partnerId: i % 4 === 0 ? "p1" : null,
    createdAt: new Date(T0 + Math.floor(i / 2) * 60_000), // ζεύγη με ίδια ώρα → χρειάζεται το id
    bookingNumber: `BP-2026-${String(i + 1).padStart(3, "0")}`,
    customer: { firstName: i % 7 === 0 ? "Νίκος" : "Maria", lastName: `Last${i}` },
    vehicle: { brand: "Fiat", model: i % 2 ? "Panda" : "500", plate: `ΧΑΝ-${1000 + i}` },
  })),
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `b${i}`, tenantId: "B", status: "PENDING", createdById: "u1", partnerId: null,
    createdAt: new Date(T0 + i * 60_000), bookingNumber: `BP-2026-${i + 1}`,
    customer: { firstName: "Νίκος", lastName: "Beta" }, vehicle: { brand: "Fiat", model: "Panda", plate: `ΗΡΚ-${i}` },
  })),
];

test("κρατήσεις: σελίδες χωρίς επικάλυψη/κενά, σταθερή σειρά, ΜΟΝΟ της εταιρίας", () => {
  const where = Q.bookingListWhere({ tenantId: "A" }, {});
  const { out, total } = pages(bookings, where, Q.BOOKING_LIST_ORDER);
  assert.equal(total, 137);
  assert.deepEqual(out.map((p) => p.length), [50, 50, 37]);
  const ids = out.flat().map((b) => b.id);
  assert.equal(new Set(ids).size, 137, "καμία διπλή");
  assert.ok(ids.every((id) => id.startsWith("a")), "καμία της Β");
  // νεότερες πρώτα, και ίδια ώρα → σταθερά με id
  const flat = out.flat();
  for (let i = 1; i < flat.length; i++) {
    const a = flat[i - 1], b = flat[i];
    assert.ok(a.createdAt > b.createdAt || (a.createdAt.getTime() === b.createdAt.getTime() && a.id > b.id));
  }
  // Ίδια αποτελέσματα σε δεύτερο πέρασμα (σταθερότητα).
  assert.deepEqual(pages(bookings, where, Q.BOOKING_LIST_ORDER).out.flat().map((b) => b.id), ids);
});

test("κρατήσεις: φίλτρο + αναζήτηση + «δικές μου» στον server, κρατιούνται σε κάθε σελίδα", () => {
  const where = Q.bookingListWhere({ tenantId: "A" }, { status: "CONFIRMED", q: "νίκος panda", mineUserId: null });
  const exp = bookings.filter((b) => b.tenantId === "A" && b.status === "CONFIRMED" && b.customer.firstName === "Νίκος" && b.vehicle.model === "Panda");
  assert.equal(query(bookings, { where, orderBy: Q.BOOKING_LIST_ORDER, skip: 0, take: 50 }).total, exp.length);
  const mine = Q.bookingListWhere({ tenantId: "A" }, { mineUserId: "u1" });
  const { out } = pages(bookings, mine, Q.BOOKING_LIST_ORDER);
  assert.ok(out.flat().every((b) => b.createdById === "u1"));
  assert.equal(out.flat().length, bookings.filter((b) => b.tenantId === "A" && b.createdById === "u1").length);
  // Συνεργάτης: ΜΟΝΟ οι δικές του, ό,τι κι αν ζητήσει.
  const partner = Q.bookingListWhere({ tenantId: "A", partnerId: "p1" }, { q: "Maria" });
  assert.ok(pages(bookings, partner, Q.BOOKING_LIST_ORDER).out.flat().every((b) => b.partnerId === "p1"));
  // Άγνωστο φίλτρο κατάστασης αγνοείται (το API δίνει 400 πριν φτάσει εδώ).
  assert.equal("status" in Q.bookingListWhere({ tenantId: "A" }, { status: "DROP TABLE" }), false);
  // Η εταιρία μπαίνει πρώτη και κανένα φίλτρο δεν την αλλάζει.
  assert.equal(Q.bookingListWhere({ tenantId: "A" }, { q: "tenantId", status: "ALL" }).tenantId, "A");
});

test("πελάτες: αλφαβητικά σε σελίδες, αναζήτηση σε όνομα/επώνυμο/email/τηλέφωνο, μόνο της εταιρίας", () => {
  const rows = [
    ...Array.from({ length: 120 }, (_, i) => ({ id: `c${String(i).padStart(3, "0")}`, tenantId: "A", firstName: i % 2 ? "Anna" : "Νίκος", lastName: `Π${String(119 - i).padStart(3, "0")}`, email: `c${i}@x.gr`, phone: `69${i}` })),
    { id: "zz", tenantId: "B", firstName: "Νίκος", lastName: "Α", email: "b@b.gr", phone: "1" },
  ];
  const { out, total } = pages(rows, Q.customerListWhere("A", ""), Q.CUSTOMER_LIST_ORDER);
  assert.equal(total, 120);
  assert.deepEqual(out.map((p) => p.length), [50, 50, 20]);
  const names = out.flat().map((c) => c.lastName);
  assert.deepEqual(names, [...names].sort());
  assert.ok(!out.flat().some((c) => c.tenantId === "B"));
  assert.equal(query(rows, { where: Q.customerListWhere("A", "νίκος c10@"), orderBy: Q.CUSTOMER_LIST_ORDER, skip: 0, take: 50 }).total, 1);
  assert.equal(query(rows, { where: Q.customerListWhere("A", "69119"), orderBy: Q.CUSTOMER_LIST_ORDER, skip: 0, take: 50 }).total, 1);
});

test("τιμολόγια: τα φίλτρα του server δίνουν ΑΚΡΙΒΩΣ ό,τι το effectiveStatus της οθόνης", () => {
  const today = "2026-10-22";
  const st = ["UNPAID", "PAID", "OVERDUE", "CANCELLED"];
  const rows = Array.from({ length: 90 }, (_, i) => ({
    id: `i${String(i).padStart(2, "0")}`,
    tenantId: i < 80 ? "A" : "B",
    status: st[i % 4],
    dueDate: new Date(`2026-10-${String(10 + (i % 20)).padStart(2, "0")}T00:00:00.000Z`),
    issueDate: new Date(T0 + i * 3600_000),
    invoiceCode: `K${i}`, invoiceNumber: `INV-${i}`,
    customer: { firstName: "Maria", lastName: `L${i}` }, booking: { bookingNumber: `BP-${i}` },
  }));
  const screen = (r) => effectiveStatus({ status: r.status, dueDate: r.dueDate.toISOString().slice(0, 10) }, today);
  const expect = {
    ALL: () => true,
    PAID: (r) => screen(r) === "PAID",
    OVERDUE: (r) => screen(r) === "OVERDUE",
    UNPAID: (r) => screen(r) === "UNPAID" || screen(r) === "OVERDUE",
  };
  for (const f of Q.INVOICE_FILTERS) {
    const where = Q.invoiceListWhere("A", { filter: f, today });
    const { out, total } = pages(rows, where, Q.INVOICE_LIST_ORDER);
    const exp = rows.filter((r) => r.tenantId === "A" && expect[f](r)).map((r) => r.id).sort().reverse();
    assert.equal(total, exp.length, f);
    assert.deepEqual(out.flat().map((r) => r.id), exp, f);
  }
  assert.equal(query(rows, { where: Q.invoiceListWhere("A", { filter: "ALL", q: "bp-1", today }), orderBy: Q.INVOICE_LIST_ORDER, skip: 0, take: 50 }).total, 11);
});

test("server: σελίδες στα API/σελίδες, ίδιες εντολές, εταιρία από τη συνεδρία, σύνολα σε ΟΛΑ", () => {
  const ls = src("src/lib/listServer.ts");
  assert.match(ls, /bookingListWhere\(bookingScope\(viewer\), \{ status: f\.status, q: f\.q, mineUserId: f\.mine \? viewer\.userId : null \}\)/);
  assert.match(ls, /customerListWhere\(tenantId, f\.q\)/);
  assert.match(ls, /invoiceListWhere\(tenantId, \{ filter: f\.filter, q: f\.q, today:/);
  assert.equal((ls.match(/pageWindow\(page, LIST_PAGE_SIZE\)/g) ?? []).length, 3);
  assert.equal((ls.match(/\.count\(\{ where \}\)/g) ?? []).length, 3);
  // Σύνοψη προμήθειας: σε ΟΛΕΣ τις κρατήσεις του χρήστη (χωρίς take), μόνο ποσά.
  const sum = ls.slice(ls.indexOf("export async function loadCommissionSummary"), ls.indexOf("export async function loadBookingPage"));
  assert.doesNotMatch(sum, /take:|skip:/);
  assert.match(sum, /where: \{ tenantId: viewer\.tenantId, \.\.\.who \}/);
  assert.match(sum, /viewer\.role === "PARTNER" \? \{ partnerId: viewer\.userId \} : \{ createdById: viewer\.userId \}/);
  // Μεμονωμένη κράτηση (Ημερολόγιο): ίδια στεγανότητα.
  assert.match(ls, /where: \{ \.\.\.bookingScope\(viewer\), id \}/);
  // API: εταιρία από τη συνεδρία, ίδιοι φύλακες.
  assert.match(src("src/app/api/customers/route.ts"), /loadCustomerPage\(session\.tenantId!/);
  assert.match(src("src/app/api/invoices/route.ts"), /loadInvoicePage\(session\.tenantId!/);
  assert.match(src("src/app/api/bookings/route.ts"), /loadBookingPage\(\s*viewer!/);
  // Σελίδες: πρώτη σελίδα από τον ίδιο κώδικα.
  assert.match(src("src/app/(dashboard)/dashboard/bookings/page.tsx"), /loadBookingPage\(viewer,/);
  assert.match(src("src/app/(dashboard)/dashboard/customers/page.tsx"), /loadCustomerPage\(session\.tenantId, \{\}\)/);
  assert.match(src("src/app/(dashboard)/dashboard/invoices/page.tsx"), /loadInvoicePage\(tenantId, \{\}\)/);
  // Και καμία λίστα από αυτές δεν φορτώνει πια τα πάντα.
  assert.doesNotMatch(src("src/app/(dashboard)/dashboard/bookings/page.tsx"), /db\.booking\.findMany/);
  assert.doesNotMatch(src("src/app/(dashboard)/dashboard/invoices/page.tsx"), /db\.invoice\.findMany/);
  assert.doesNotMatch(src("src/app/(dashboard)/dashboard/customers/page.tsx"), /db\.customer\.findMany/);
  // SQL 32: indexes για την ταξινόμηση.
  const sql = src("prisma/sql/32-list-indexes.sql");
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "customers_tenantId_lastName_firstName_id_idx"/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "invoices_tenantId_issueDate_id_idx"/);
});

test("σύνοψη προμήθειας: ίδιος υπολογισμός, πάνω σε όλες (όχι μόνο στη σελίδα)", async () => {
  const { summarize } = await import("../src/lib/commission.ts");
  const s = { rate: 10, onRental: true, onExtras: false, onInsurance: false };
  const rows = Array.from({ length: 120 }, (_, i) => ({ status: i % 10 === 0 ? "CANCELLED" : "CONFIRMED", subtotal: 100, extrasTotal: 0, insuranceCost: 0 }));
  assert.deepEqual(summarize(rows, s), { bookings: 108, base: 10800, commission: 1080 });
  assert.notDeepEqual(summarize(rows.slice(0, 50), s), summarize(rows, s), "η πρώτη σελίδα μόνη της θα έδινε λάθος σύνολο");
});
