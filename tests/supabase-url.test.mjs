// tests/supabase-url.test.mjs
// Κανονικοποίηση του SUPABASE_URL (src/lib/storage.ts).
// Τρέχει με τον ενσωματωμένο test runner της Node: `npm test`.
// (Η Node 22 φορτώνει το .ts απευθείας· το storage.ts δεν έχει imports.)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSupabaseUrl,
  storageConfigProblem,
  storageStartupProblem,
} from "../src/lib/storage.ts";

const REF = "abcdefghijklmnopqrst";
const GOOD = `https://${REF}.supabase.co`;

test("σωστή τιμή μένει ως έχει", () => {
  assert.deepEqual(normalizeSupabaseUrl(GOOD), { ok: true, url: GOOD, fixedFromDashboard: false });
});

test("«/» στο τέλος (μία ή περισσότερες)", () => {
  assert.equal(normalizeSupabaseUrl(`${GOOD}/`).url, GOOD);
  assert.equal(normalizeSupabaseUrl(`${GOOD}///`).url, GOOD);
});

test("κενά, αλλαγές γραμμής και εισαγωγικά γύρω από την τιμή", () => {
  assert.equal(normalizeSupabaseUrl(`  ${GOOD}  `).url, GOOD);
  assert.equal(normalizeSupabaseUrl(`\n${GOOD}\r\n`).url, GOOD);
  assert.equal(normalizeSupabaseUrl(`"${GOOD}"`).url, GOOD);
  assert.equal(normalizeSupabaseUrl(` '${GOOD}/' `).url, GOOD);
});

test("καταλήξεις /rest/v1, /storage/v1, /auth/v1", () => {
  assert.equal(normalizeSupabaseUrl(`${GOOD}/rest/v1`).url, GOOD);
  assert.equal(normalizeSupabaseUrl(`${GOOD}/rest/v1/`).url, GOOD);
  assert.equal(normalizeSupabaseUrl(`${GOOD}/storage/v1`).url, GOOD);
  assert.equal(normalizeSupabaseUrl(`${GOOD}/auth/v1/`).url, GOOD);
  assert.equal(normalizeSupabaseUrl(`${GOOD.toUpperCase().replace("HTTPS", "https")}/REST/V1`).url, GOOD);
});

test("διεύθυνση dashboard → https://<ref>.supabase.co", () => {
  for (const v of [
    `https://supabase.com/dashboard/project/${REF}`,
    `https://supabase.com/dashboard/project/${REF}/settings/api`,
    `supabase.com/dashboard/project/${REF}?tab=x`,
    ` "https://app.supabase.com/dashboard/project/${REF}/" `,
  ]) {
    assert.deepEqual(normalizeSupabaseUrl(v), { ok: true, url: GOOD, fixedFromDashboard: true }, v);
  }
});

test("εντελώς λάθος τιμές απορρίπτονται", () => {
  for (const v of [
    "",
    "   ",
    "hello",
    `http://${REF}.supabase.co`, // όχι https
    `${REF}.supabase.co`, // χωρίς σχήμα
    "https://example.com",
    `https://${REF}.supabase.co.evil.com`,
    `https://${REF}.supabase.co/other/path`,
    `https://${REF}.supabase.co?x=1`,
    `https://user:pass@${REF}.supabase.co`,
    `https://${REF}.supabase.co:8443`,
    "https://supabase.co",
    "https://supabase.com/dashboard/project/",
    "postgresql://postgres@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
  ]) {
    assert.deepEqual(normalizeSupabaseUrl(v), { ok: false }, JSON.stringify(v));
  }
});

test("έλεγχος εκκίνησης = ίδιο κριτήριο με το ανέβασμα· μηνύματα χωρίς τιμές", () => {
  const saved = { ...process.env };
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(" "));
  try {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-value-not-secret";

    process.env.SUPABASE_URL = ` "${GOOD}/rest/v1/" `;
    assert.equal(storageConfigProblem(), null);
    assert.equal(storageStartupProblem(), null);

    process.env.SUPABASE_URL = "https://example.com/my-project";
    const bad = storageStartupProblem();
    assert.equal(bad?.code, "CONFIG_INVALID_URL");
    assert.ok(!bad.message.includes("example.com"), "το μήνυμα δεν περιέχει την τιμή");
    assert.ok(bad.message.includes("https://<ref>.supabase.co"));

    process.env.SUPABASE_URL = `https://supabase.com/dashboard/project/${REF}`;
    assert.equal(storageConfigProblem(), null);
    assert.equal(warnings.length, 1, "η αυτόματη διόρθωση γράφεται στο log");
    assert.ok(!warnings[0].includes(REF), "το log δεν περιέχει την τιμή");
    assert.ok(!warnings.join(" ").includes("test-key-value"), "το log δεν περιέχει κλειδί");

    delete process.env.SUPABASE_URL;
    const missing = storageConfigProblem();
    assert.equal(missing?.code, "CONFIG_MISSING");
    assert.ok(missing.message.includes("SUPABASE_URL"));
    assert.ok(!missing.message.includes("test-key-value"));
  } finally {
    console.warn = origWarn;
    process.env = saved;
  }
});
