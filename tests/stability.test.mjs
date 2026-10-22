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
