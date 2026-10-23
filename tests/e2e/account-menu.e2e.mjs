// tests/e2e/account-menu.e2e.mjs — μενού λογαριασμού σε Admin/Staff/Partner,
// κινητό (360/390/430) και desktop. ΔΕΝ τρέχει με `npm test`.
//
//   BASE_URL=… ADMIN_EMAIL=… STAFF_EMAIL=… PARTNER_EMAIL=… PASSWORD=… \
//   node --test tests/e2e/account-menu.e2e.mjs
// (PASSWORD κοινός για τους τρεις λογαριασμούς δοκιμής· PLAYWRIGHT_MODULE αν χρειάζεται.)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const PASSWORD = process.env.PASSWORD;
const ROLES = [
  ["Admin", process.env.ADMIN_EMAIL],
  ["Staff", process.env.STAFF_EMAIL],
  ["Partner", process.env.PARTNER_EMAIL],
];
const XFF = { "x-forwarded-for": `10.44.${Date.now() % 250}.7` };
let browser;
before(async () => (browser = await chromium.launch()));
after(async () => browser?.close());

async function session(email, viewport) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport, extraHTTPHeaders: XFF });
  const r = await ctx.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  assert.equal(r.status(), 200, `login ${email}`);
  return ctx;
}

/** Ορατό ΜΕΣΑ στο αρχικό παράθυρο (χωρίς κύλισμα). */
async function inViewport(page, locator) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  return box && box.y >= 0 && box.x >= 0 && box.y + box.height <= vp.height && box.x + box.width <= vp.width;
}

for (const [label, email] of ROLES) {
  for (const width of [360, 390, 430]) {
    test(`${label} @${width}px: λογαριασμός ορατός χωρίς κύλισμα/μενού, γλώσσα, σελίδα, αποσύνδεση`, async () => {
      const ctx = await session(email, { width, height: 740 });
      const page = await ctx.newPage();
      await page.goto("/dashboard");
      // Κύλισμα κάτω: η μπάρα μένει (sticky)
      await page.mouse.wheel(0, 2000);
      const btn = page.getByTestId("account-menu-topbar");
      assert.ok(await inViewport(page, btn), "κουμπί λογαριασμού στο ορατό μέρος");
      assert.equal(await page.getByTestId("account-menu-sidebar").isVisible(), false, "όχι διπλό");
      await btn.click();
      const pop = page.locator(".dash-account--topbar .dash-account-pop");
      assert.ok(await inViewport(page, pop), "το μενού χωράει στην οθόνη");
      assert.match(await pop.innerText(), new RegExp(email.replace(/[.+]/g, "\\$&")));
      // Γλώσσα → EN και πίσω → ΕΛ (ίδιος μηχανισμός αποθήκευσης)
      await pop.getByRole("button", { name: "EN" }).click();
      await page.getByRole("menuitem", { name: "My account" }).waitFor();
      await page.getByRole("button", { name: "ΕΛ", pressed: false }).click();
      await page.getByRole("menuitem", { name: "Ο λογαριασμός μου" }).click();
      await page.waitForURL(/\/dashboard\/account/);
      await page.getByTestId("account-page").waitFor();
      assert.match(await page.getByTestId("account-page").innerText(), new RegExp(email.replace(/[.+]/g, "\\$&")));
      // Αποσύνδεση από το μενού
      await page.getByTestId("account-menu-topbar").click();
      await page.getByRole("menuitem", { name: "Αποσύνδεση" }).click();
      await page.waitForURL(/\/login/);
      const after = await ctx.request.get("/api/auth/me");
      assert.equal(after.status(), 401, "η συνεδρία έκλεισε");
      await ctx.close();
    });
  }

  test(`${label} desktop: μενού στην κορυφή του sidebar, αποσύνδεση από τη σελίδα «Ο λογαριασμός μου»`, async () => {
    const ctx = await session(email, { width: 1280, height: 720 });
    const page = await ctx.newPage();
    await page.goto("/dashboard/account");
    const btn = page.getByTestId("account-menu-sidebar");
    assert.ok(await inViewport(page, btn));
    assert.equal(await page.getByTestId("account-menu-topbar").isVisible(), false);
    await page.getByTestId("account-page").getByRole("button", { name: "Αποσύνδεση" }).click();
    await page.waitForURL(/\/login/);
    assert.equal((await ctx.request.get("/api/auth/me")).status(), 401);
    await ctx.close();
  });
}
