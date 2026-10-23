// tests/account-menu.test.mjs
// «Ο λογαριασμός μου» + σταθερό μενού λογαριασμού (γλώσσα, αποσύνδεση).
// Στατικοί έλεγχοι — χωρίς βάση. Η δοκιμή στον browser (Admin/Staff/Partner,
// κινητό και desktop): tests/e2e/account-menu.e2e.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const D = "src/app/(dashboard)/dashboard";

test("το μενού λογαριασμού μπαίνει στη σταθερή μπάρα κινητού ΚΑΙ στην κορυφή του sidebar", () => {
  const sb = read(`${D}/DashboardSidebar.tsx`);
  const topbar = sb.slice(sb.indexOf('className="dash-topbar"'), sb.indexOf("{/* Overlay */}"));
  assert.match(topbar, /<AccountMenu [^>]*variant="topbar"/);
  const aside = sb.slice(sb.indexOf("<aside"));
  // Πριν από το <nav>: στην κορυφή, όχι στο κάτω μέρος
  assert.ok(aside.indexOf('variant="sidebar"') < aside.indexOf('<nav className="dash-nav">'));
});

test("όχι διπλά: η παλιά γλώσσα/αποσύνδεση στο κάτω μέρος του sidebar αφαιρέθηκε", () => {
  const sb = read(`${D}/DashboardSidebar.tsx`);
  assert.doesNotMatch(sb, /className="dash-lang"|dash-logout|\/api\/auth\/logout|\/api\/users\/me\/locale/);
  const css = read(`${D}/dashboard.css`);
  assert.doesNotMatch(css, /\.dash-logout\s*\{/);
  // Στο κινητό το μενού του sidebar κρύβεται (ζει στη μπάρα) — όχι δύο ορατά
  assert.match(css, /\.dash-account--sidebar \{\s*display: none;/);
});

test("ίδιοι μηχανισμοί: γλώσσα στο /api/users/me/locale, αποσύνδεση στο /api/auth/logout — κανένα νέο API", () => {
  const a = read(`${D}/useAccountActions.ts`);
  assert.match(a, /fetch\("\/api\/users\/me\/locale", \{\s*method: "PATCH"/);
  assert.match(a, /fetch\("\/api\/auth\/logout", \{ method: "POST" \}\)/);
  assert.equal(existsSync(new URL("../src/app/api/account", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/app/api/users/me/route.ts", import.meta.url)), false);
});

test("«Ο λογαριασμός μου»: για ΟΛΟΥΣ τους ρόλους, μόνο ο ίδιος χρήστης, καμία αλλαγή δικαιωμάτων", () => {
  const page = read(`${D}/account/page.tsx`);
  assert.doesNotMatch(page, /pageGuard\(|viewerCan\(|COMPANY_ADMIN/, "κανένα δικαίωμα/ρόλος");
  assert.match(page, /const viewer = await loadViewer\(session\);\s*if \(!viewer\) redirect\("\/login"\);/);
  assert.match(page, /where: \{ id: viewer\.userId \}/);
  // Όχι κάτω από τις διαδρομές μόνο-για-Admin του middleware
  const mw = read("src/middleware.ts");
  const admin = mw.slice(mw.indexOf("const ADMIN_ROUTES"), mw.indexOf("];", mw.indexOf("const ADMIN_ROUTES")));
  assert.doesNotMatch(admin, /account/);
  assert.doesNotMatch(read("src/lib/permissions.ts"), /account/);
});

test("κείμενα από τα λεξικά el/en", () => {
  for (const [f, title] of [["src/lib/i18n/el.ts", "Ο λογαριασμός μου"], ["src/lib/i18n/en.ts", "My account"]]) {
    const s = read(f);
    assert.match(s, new RegExp(`account: \\{\\s*title: "${title}"`));
  }
  for (const f of [`${D}/AccountMenu.tsx`, `${D}/account/AccountClient.tsx`]) {
    assert.doesNotMatch(read(f), />\s*(Αποσύνδεση|Logout|Sign out)\s*</, f);
  }
});

test("super admin: η αποσύνδεση του κινητού μένει σταθερή στην κορυφή", () => {
  assert.match(read("src/app/(super-admin)/super-admin/page.tsx"), /\.sa-mobile-bar \{[^}]*position: sticky; top: 0;/);
});
