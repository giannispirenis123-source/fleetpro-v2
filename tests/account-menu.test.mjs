// tests/account-menu.test.mjs
// «Ο λογαριασμός μου» + σταθερό μενού λογαριασμού (γλώσσα, αποσύνδεση).
// Στατικοί έλεγχοι — χωρίς βάση. Η δοκιμή στον browser (Admin/Staff/Partner,
// κινητό και desktop): tests/e2e/account-menu.e2e.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const D = "src/app/(dashboard)/dashboard";
const C = "src/components/account";
const SA = "src/app/(super-admin)/super-admin";

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
  const a = read(`${C}/useAccountActions.ts`);
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
  for (const f of [`${C}/AccountMenu.tsx`, `${D}/account/AccountClient.tsx`]) {
    assert.doesNotMatch(read(f), />\s*(Αποσύνδεση|Logout|Sign out)\s*</, f);
  }
});

test("ΕΝΑ component μενού: dashboard ΚΑΙ Super Admin χρησιμοποιούν το ίδιο AccountMenu", () => {
  assert.match(read(`${D}/DashboardSidebar.tsx`), /import AccountMenu from "@\/components\/account\/AccountMenu";/);
  const sa = read(`${SA}/page.tsx`);
  assert.match(sa, /import AccountMenu from "@\/components\/account\/AccountMenu";/);
  assert.equal(existsSync(new URL(`../${D}/AccountMenu.tsx`, import.meta.url)), false, "όχι δεύτερο αντίγραφο");
  // Το CSS του μενού ζει μαζί του (το super-admin δεν φορτώνει το dashboard.css)
  assert.match(read(`${C}/AccountMenu.tsx`), /import "\.\/account-menu\.css";/);
  assert.match(read(`${C}/account-menu.css`), /\.dash-account-pop \{/);
});

test("Super Admin: πραγματικό όνομα/email από τη συνεδρία, όχι σταθερά κείμενα", () => {
  const sa = read(`${SA}/page.tsx`);
  assert.doesNotMatch(sa, /admin@fleetpro\.gr/);
  assert.doesNotMatch(sa, /sa-user-name">Super Admin</);
  assert.match(sa, /<AccountMenu name=\{me\.name\} email=\{me\.email\} role="SUPER_ADMIN" variant="sidebar" accountHref=\{null\} \/>/);
  assert.match(sa, /<AccountMenu name=\{me\.name\} email=\{me\.email\} role="SUPER_ADMIN" variant="topbar" accountHref=\{null\} \/>/);
  const layout = read(`${SA}/layout.tsx`);
  assert.match(layout, /db\.user\.findUnique\(\{ where: \{ id: session\.userId \}, select: \{ name: true, email: true \} \}\)/);
});

test("Super Admin: χωρίς «Ο λογαριασμός μου» (δεν υπάρχει σελίδα), χωρίς πρόσβαση στο dashboard εταιρίας", () => {
  const menu = read(`${C}/AccountMenu.tsx`);
  assert.match(menu, /\{accountHref && \(\s*<Link\s*href=\{accountHref\}/);
  // Το middleware συνεχίζει να στέλνει τον Super Admin από /dashboard στο /super-admin
  assert.match(read("src/middleware.ts"), /pathname === "\/dashboard" && session\.role === "SUPER_ADMIN"/);
  assert.match(read(`${D}/layout.tsx`), /if \(session\.role === "SUPER_ADMIN"\) redirect\("\/super-admin"\);/);
});

test("Super Admin: όχι διπλά — το παλιό σκέτο κουμπί και το footer αφαιρέθηκαν, η μπάρα κινητού sticky", () => {
  const sa = read(`${SA}/page.tsx`);
  assert.doesNotMatch(sa, /sa-mobile-logout|sa-sidebar-footer|className="sa-logout"|handleLogout|\/api\/auth\/logout/);
  assert.match(sa, /\.sa-mobile-bar \{[^}]*position: sticky; top: 0;/);
  // overflow: clip στο .sa-main — αλλιώς το sticky δεν δουλεύει μέσα του
  assert.match(sa, /\.sa-main \{[^}]*overflow: clip;/);
});

test("ρόλος Super Admin στο μενού από τα λεξικά", () => {
  assert.match(read(`${C}/useAccountActions.ts`), /SUPER_ADMIN: "sidebar\.roleSuperAdmin"/);
  assert.match(read("src/lib/i18n/el.ts"), /roleSuperAdmin: "Super Admin"/);
  assert.match(read("src/lib/i18n/en.ts"), /roleSuperAdmin: "Super Admin"/);
});
