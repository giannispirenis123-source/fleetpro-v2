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
