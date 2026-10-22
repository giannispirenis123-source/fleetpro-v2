// tests/e2e/self-signup.e2e.mjs — Playwright E2E της αυτόματης εγγραφής (SQL 34).
// ΔΕΝ τρέχει με `npm test` (θέλει server + βάση). Τρέχει στο preview ή τοπικά:
//
//   BASE_URL=https://<preview>.vercel.app \
//   node --test tests/e2e/self-signup.e2e.mjs
//
// Στον server: SELF_SIGNUP_ENABLED=true ΚΑΙ SIGNUP_TEST_EMAILS=1 (τα email δεν
// στέλνονται· επιστρέφονται στην απάντηση — ΠΟΤΕ στο Vercel Production).
// Προαιρετικά:
//   OFF_BASE_URL  — 2ος server με SELF_SIGNUP_ENABLED off (έλεγχος 404)
//   DATABASE_URL  — μόνο τοπικά: λήξη token (psql) και ids άλλης εταιρίας
//   E2E_LOCAL=1   — μόνο τοπικά: δικό του x-forwarded-for ανά εκτέλεση + όριο 5/ώρα
//   PLAYWRIGHT_MODULE — διαδρομή του πακέτου playwright αν δεν είναι εγκατεστημένο τοπικά
// Κάθε εκτέλεση φτιάχνει ΝΕΕΣ δοκιμαστικές εταιρίες (e2e-…): σβήνονται από τον Super Admin.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const BASE = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const OFF = process.env.OFF_BASE_URL?.replace(/\/$/, "");
const DB = process.env.DATABASE_URL;
const LOCAL = process.env.E2E_LOCAL === "1";
const RUN = Date.now().toString(36);
const IP = `10.${(Date.now() >> 16) & 255}.${(Date.now() >> 8) & 255}.${Date.now() & 255}`;
const PASSWORD = "e2e-pass-1234";
const NEUTRAL = "Αν το email είναι διαθέσιμο";

let browser;
const headers = LOCAL ? { "x-forwarded-for": IP } : {};
const newContext = () => browser.newContext({ baseURL: BASE, extraHTTPHeaders: headers, locale: "el-GR" });

before(async () => {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => browser?.close());

const sql = (q) => execFileSync("psql", [DB, "-At", "-c", q], { encoding: "utf8" }).trim();

/** Εγγραφή μέσω της φόρμας· επιστρέφει την απάντηση του API (με testEmail). */
async function signupViaForm(page, { company, email, honeypot }) {
  await page.goto("/signup");
  await page.fill('input[name="companyName"]', company);
  await page.fill('input[name="ownerName"]', "E2E Owner");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  if (honeypot) await page.locator('input[name="website"]').fill(honeypot, { force: true });
  await page.check('input[name="acceptTerms"]');
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/auth/signup")),
    page.click('button[type="submit"]'),
  ]);
  const body = await res.json();
  await page.getByTestId("signup-sent").waitFor();
  assert.match(await page.getByTestId("signup-sent").innerText(), new RegExp(NEUTRAL));
  return { status: res.status(), body };
}

const linkOf = (testEmail) => {
  assert.ok(testEmail, "λείπει testEmail — είναι ενεργό το SIGNUP_TEST_EMAILS=1;");
  const m = testEmail.text.match(/https?:\/\/\S+\/verify-email\?token=[A-Za-z0-9_-]+/);
  assert.ok(m, "σύνδεσμος επαλήθευσης στο email");
  return m[0];
};

const loginStatus = async (ctx, email, password = PASSWORD) => {
  const r = await ctx.request.post("/api/auth/login", { data: { email, password } });
  return { status: r.status(), body: await r.json() };
};

const state = {};

test("ΡΟΗ: εγγραφή → επαλήθευση → onboarding → πρώτο όχημα → δημοσίευση → δημόσια σελίδα", async () => {
  const ctx = await newContext();
  const page = await ctx.newPage();
  state.email = `e2e-${RUN}@example.com`;

  // Σύνδεσμος «Δημιουργία εταιρίας» στο login
  await page.goto("/login");
  await page.getByRole("link", { name: "Δημιουργία εταιρίας" }).click();
  await page.waitForURL(/\/signup/);

  const { status, body } = await signupViaForm(page, { company: `E2E Χανιά Ενοικιάσεις ${RUN}`, email: state.email });
  assert.equal(status, 200);
  assert.equal(body.testEmail.to, state.email);
  const link = linkOf(body.testEmail);

  // Πριν την επαλήθευση: όχι login, όχι dashboard
  const pre = await loginStatus(ctx, state.email);
  assert.equal(pre.status, 400);
  assert.equal(pre.body.code, "unverified");
  await page.goto("/dashboard");
  await page.waitForURL(/\/login/);

  // Επαλήθευση → αυτόματη σύνδεση → onboarding
  await page.goto(link);
  await page.getByRole("button", { name: "Επιβεβαίωση και συνέχεια" }).click();
  await page.waitForURL(/\/dashboard\/onboarding/);
  await page.getByRole("heading", { name: "Ας στήσουμε την εταιρία σας" }).waitFor();

  // Ο ίδιος σύνδεσμος δεύτερη φορά → άκυρος (μίας χρήσης)
  const again = await ctx.request.post("/api/auth/verify-email", { data: { token: new URL(link).searchParams.get("token") } });
  assert.equal(again.status(), 400);

  // Α. Στοιχεία εταιρίας + slug (δεσμευμένο → σφάλμα, μετά διαθέσιμο)
  const company = page.locator('li[data-step="company"]');
  await company.getByLabel("Τηλέφωνο", { exact: true }).fill("+30 28210 00000");
  await company.getByLabel("Διεύθυνση", { exact: true }).fill("Κάτω Δαράτσο, Χανιά");
  const slugInput = company.locator('input[name="slug"]');
  state.slug = `e2e-${RUN}`;
  await slugInput.fill("admin");
  await company.locator(".dash-sf-err").waitFor();
  await slugInput.fill(state.slug);
  await company.getByText("Διαθέσιμο").waitFor();
  await company.getByRole("button", { name: "Αποθήκευση" }).click();
  await page.locator('li[data-step="company"].is-done').waitFor();

  // Πριν τη δημοσίευση: η σελίδα 404 για επισκέπτη (άλλο context, χωρίς cookie)
  const anon = await newContext();
  assert.equal((await anon.request.get(`/s/${state.slug}/el`, { maxRedirects: 0 })).status(), 404);

  // Β. Πρώτο όχημα με την ΥΠΑΡΧΟΥΣΑ φόρμα του Στόλου
  await page.locator('li[data-step="vehicle"]').getByRole("button", { name: "Προσθήκη οχήματος" }).click();
  const modal = page.locator(".dash-modal");
  await modal.getByLabel("Μάρκα").fill("Fiat");
  await modal.getByLabel("Μοντέλο").fill("Panda");
  await modal.getByLabel("Πινακίδα").fill(`E2E-${RUN.slice(-4).toUpperCase()}`);
  await modal.getByLabel("Έτος").fill("2023");
  await modal.getByLabel(/Ημερήσια τιμή/).fill("40");
  await modal.getByRole("button", { name: "Αποθήκευση" }).click();
  await page.locator('li[data-step="vehicle"].is-done').waitFor();

  // Banner προόδου σε άλλη σελίδα του dashboard (Α, Β έγιναν, Δ όχι)
  await page.goto("/dashboard/fleet");
  await page.getByTestId("onboarding-banner").waitFor();
  assert.match(await page.getByTestId("onboarding-banner").innerText(), /2\/3/);
  await page.goto("/dashboard/onboarding");

  // Δ. Προεπισκόπηση (μόνο για τον Διαχειριστή) + Δημοσίευση
  const frame = page.frameLocator("iframe.dash-onb-preview");
  await frame.locator("body").waitFor();
  const previewRes = await ctx.request.get(`/s/${state.slug}/el`);
  assert.equal(previewRes.status(), 200, "προεπισκόπηση Διαχειριστή");
  await page.getByTestId("onb-publish").click();
  await page.locator('li[data-step="publish"].is-done').waitFor();
  await page.getByText("Η εταιρία σας είναι έτοιμη!").waitFor();

  // Η δημόσια σελίδα φορτώνει για επισκέπτη
  const pub = await anon.newPage();
  const res = await pub.goto(`/s/${state.slug}/el`);
  assert.equal(res.status(), 200);
  assert.match(await pub.content(), new RegExp(`E2E Χανιά Ενοικιάσεις ${RUN}`));

  // Χωρίς banner πια
  await page.goto("/dashboard/fleet");
  assert.equal(await page.getByTestId("onboarding-banner").count(), 0);

  state.ctx = ctx;
  await anon.close();
});

test("ΑΠΟΜΟΝΩΣΗ: ο νέος χρήστης βλέπει μόνο τα δικά του", async () => {
  const ctx = state.ctx;
  assert.ok(ctx, "χρειάζεται η ροή");
  const vehicles = await (await ctx.request.get("/api/vehicles")).json();
  const list = vehicles.data.vehicles ?? vehicles.data.items ?? vehicles.data;
  assert.equal(list.length, 1, "μόνο το δικό του όχημα");
  const customers = await (await ctx.request.get("/api/customers")).json();
  assert.equal(customers.data.total, 0);
  const bookings = await (await ctx.request.get("/api/bookings")).json();
  assert.equal(bookings.data.total, 0);
  assert.equal((await ctx.request.get("/api/tenants")).status(), 403, "όχι Super Admin API");
  assert.equal((await ctx.request.get("/api/super-admin/signup-cleanup")).status(), 403);
  if (DB) {
    const otherVehicle = sql(`SELECT v.id FROM vehicles v JOIN tenants t ON t.id = v."tenantId" WHERE t.slug NOT LIKE 'e2e-%' AND t."signupSource" = 'manual' LIMIT 1`);
    if (otherVehicle) {
      for (const [m, data] of [["patch", { notes: "x" }], ["delete", undefined]]) {
        const r = await ctx.request[m](`/api/vehicles/${otherVehicle}`, data ? { data } : {});
        assert.ok([403, 404].includes(r.status()), `${m} όχημα άλλης εταιρίας → ${r.status()}`);
      }
    }
  }
  await ctx.close();
});

test("ΔΙΠΛΟ EMAIL: ίδια απάντηση, ουδέτερο email, τίποτα δεν δημιουργείται", async () => {
  const ctx = await newContext();
  const page = await ctx.newPage();
  const { status, body } = await signupViaForm(page, { company: `E2E Διπλό ${RUN}`, email: state.email.toUpperCase() });
  assert.equal(status, 200);
  assert.match(body.message, new RegExp(NEUTRAL));
  assert.match(body.testEmail.subject, /Προσπάθεια εγγραφής/);
  assert.doesNotMatch(body.testEmail.text, /verify-email/);
  // Ο λογαριασμός δεν άλλαξε: ο αρχικός κωδικός ισχύει (δεν φτιάχτηκε δεύτερος)
  assert.equal((await loginStatus(ctx, state.email)).status, 200);
  if (DB) assert.equal(sql(`SELECT count(*) FROM tenants WHERE name = 'E2E Διπλό ${RUN}'`), "0");
  await ctx.close();
});

test("HONEYPOT: «επιτυχία» χωρίς να δημιουργηθεί τίποτα", async () => {
  const ctx = await newContext();
  const page = await ctx.newPage();
  const email = `e2e-bot-${RUN}@example.com`;
  const { status, body } = await signupViaForm(page, { company: `E2E Bot ${RUN}`, email, honeypot: "http://spam.example" });
  assert.equal(status, 200);
  assert.match(body.message, new RegExp(NEUTRAL));
  assert.equal(body.testEmail, undefined, "κανένα email");
  assert.equal((await loginStatus(ctx, email)).status, 400);
  assert.equal((await loginStatus(ctx, email)).body.code, undefined, "λάθος στοιχεία, όχι «unverified»");
  if (DB) assert.equal(sql(`SELECT count(*) FROM users WHERE email = '${email}'`), "0");
  await ctx.close();
});

test("ΛΗΞΗ TOKEN: ληγμένος σύνδεσμος → μήνυμα + «ξαναστείλε» → νέος σύνδεσμος δουλεύει", async (t) => {
  if (!DB) return t.skip("θέλει DATABASE_URL (μόνο τοπικά)");
  const ctx = await newContext();
  const page = await ctx.newPage();
  const email = `e2e-exp-${RUN}@example.com`;
  const { body } = await signupViaForm(page, { company: `E2E Λήξη ${RUN}`, email });
  const link = linkOf(body.testEmail);
  sql(`UPDATE email_verification_tokens SET "expiresAt" = now() - interval '1 minute' WHERE "userId" = (SELECT id FROM users WHERE email = '${email}')`);
  await page.goto(link);
  await page.getByRole("button", { name: "Επιβεβαίωση και συνέχεια" }).click();
  await page.getByTestId("verify-error").waitFor();
  assert.match(await page.getByTestId("verify-error").innerText(), /έληξε/);

  await page.fill('input[name="email"]', email);
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/auth/resend-verification")),
    page.getByRole("button", { name: "Ξαναστείλε email" }).click(),
  ]);
  const resent = await res.json();
  await page.getByTestId("resend-sent").waitFor();
  const fresh = linkOf(resent.testEmail);
  assert.notEqual(fresh, link);
  // Ο παλιός σύνδεσμος ακυρώθηκε
  const old = await ctx.request.post("/api/auth/verify-email", { data: { token: new URL(link).searchParams.get("token") } });
  assert.equal(old.status(), 400);
  await page.goto(fresh);
  await page.getByRole("button", { name: "Επιβεβαίωση και συνέχεια" }).click();
  await page.waitForURL(/\/dashboard\/onboarding/);
  await ctx.close();
});

test("ΞΑΝΑΣΤΕΙΛΕ για άγνωστο email: ίδια ουδέτερη απάντηση, κανένα email", async () => {
  const ctx = await newContext();
  const r = await ctx.request.post("/api/auth/resend-verification", { data: { email: `nobody-${RUN}@example.com` } });
  assert.equal(r.status(), 200);
  const b = await r.json();
  assert.match(b.message, /Αν υπάρχει λογαριασμός/);
  assert.equal(b.testEmail, undefined);
  await ctx.close();
});

test("ΟΡΙΟ: 6η εγγραφή από την ίδια IP μέσα στην ώρα → 429", async (t) => {
  if (!LOCAL) return t.skip("μόνο τοπικά (E2E_LOCAL=1): στο preview το x-forwarded-for το βάζει το Vercel");
  const ctx = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": `${IP}9` } });
  const codes = [];
  for (let i = 0; i < 6; i++) {
    const r = await ctx.request.post("/api/auth/signup", {
      data: { companyName: `E2E Rate ${RUN} ${i}`, ownerName: "E2E", email: `e2e-rate-${RUN}-${i}@example.com`, password: PASSWORD, acceptTerms: true },
    });
    codes.push(r.status());
  }
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
  await ctx.close();
});

test("ΔΙΑΚΟΠΤΗΣ OFF: /signup, /verify-email και τα endpoints → 404, χωρίς σύνδεσμο στο login", async (t) => {
  if (!OFF) return t.skip("θέλει OFF_BASE_URL (server με SELF_SIGNUP_ENABLED off)");
  const ctx = await browser.newContext({ baseURL: OFF, extraHTTPHeaders: headers });
  for (const p of ["/signup", "/verify-email", "/verify-email?token=x"]) {
    assert.equal((await ctx.request.get(p)).status(), 404, p);
  }
  for (const p of ["/api/auth/signup", "/api/auth/verify-email", "/api/auth/resend-verification"]) {
    assert.equal((await ctx.request.post(p, { data: {} })).status(), 404, p);
  }
  const page = await ctx.newPage();
  await page.goto("/login");
  assert.equal(await page.getByRole("link", { name: "Δημιουργία εταιρίας" }).count(), 0);
  assert.equal(await page.locator('a[href*="/signup"]').count(), 0);
  await ctx.close();
});

test("ΝΟΜΙΚΑ: placeholder σελίδες με σαφές «προσωρινό κείμενο»", async () => {
  const ctx = await newContext();
  const page = await ctx.newPage();
  for (const p of ["/legal/terms", "/legal/privacy"]) {
    const r = await page.goto(p);
    assert.equal(r.status(), 200, p);
    assert.match(await page.getByTestId("legal-draft").innerText(), /ΠΡΟΣΩΡΙΝΟ ΚΕΙΜΕΝΟ/);
  }
  await ctx.close();
});
