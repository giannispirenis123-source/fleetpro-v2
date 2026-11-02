// tests/site-staff-login.test.mjs — «Σύνδεση / Dashboard» από το δημόσιο site:
// ΙΔΙΟ login της πλατφόρμας, ανακατεύθυνση ανά ρόλο, εταιρία ΜΟΝΟ από το
// session (cross-tenant), callbackUrl χωρίς open redirect, γενικό μήνυμα λάθους.

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

const R = await import("../src/lib/loginRedirect.ts");
const { LOGIN_MSG, loginDecision } = await import("../src/lib/loginCore.ts");
const { storefrontDictionary } = await import("../src/lib/storefront/i18n.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("ανακατεύθυνση ανά ρόλο: super admin → /super-admin, admin/staff/partner → /dashboard", () => {
  assert.equal(R.loginRedirectFor("SUPER_ADMIN"), "/super-admin");
  for (const role of ["COMPANY_ADMIN", "STAFF", "PARTNER"]) assert.equal(R.loginRedirectFor(role), "/dashboard", role);
  // Ασφαλές callback ΜΕΣΑ στην περιοχή του ρόλου κρατιέται.
  assert.equal(R.loginRedirectFor("STAFF", "/dashboard/bookings?status=PENDING"), "/dashboard/bookings?status=PENDING");
  assert.equal(R.loginRedirectFor("SUPER_ADMIN", "/super-admin?tab=stats"), "/super-admin?tab=stats");
  // Callback σε ΑΛΛΗ περιοχή → η περιοχή του ρόλου.
  assert.equal(R.loginRedirectFor("STAFF", "/super-admin"), "/dashboard");
  assert.equal(R.loginRedirectFor("SUPER_ADMIN", "/dashboard"), "/super-admin");
  assert.equal(R.loginRedirectFor("COMPANY_ADMIN", "/dashboard-evil"), "/dashboard");
  // Το API επιστρέφει αυτόν τον προορισμό (όχι σταθερό /dashboard, όχι από το body χωρίς έλεγχο).
  const api = read("src/app/api/auth/login/route.ts");
  assert.match(api, /redirectTo: loginRedirectFor\(user\.role, callbackUrl\)/);
  assert.match(api, /callbackUrl: z\.string\(\)\.max\(512\)\.optional\(\)/);
});

test("open redirect: μόνο σχετική διαδρομή της εφαρμογής", () => {
  const bad = [
    "https://evil.com/dashboard",
    "http://evil.com",
    "//evil.com/dashboard",
    "/\\evil.com",
    "\\\\evil.com",
    "/\t/evil.com",
    "/%0a/evil.com".replace("%0a", "\n"),
    "javascript:alert(1)",
    "data:text/html,x",
    "dashboard",
    " https://evil.com",
    "",
    null,
    undefined,
    42,
    "/" + "a".repeat(600),
  ];
  for (const v of bad) {
    assert.equal(R.safeCallbackPath(v), null, JSON.stringify(v));
    assert.equal(R.loginRedirectFor("COMPANY_ADMIN", v), "/dashboard", JSON.stringify(v));
    assert.equal(R.loginRedirectFor("SUPER_ADMIN", v), "/super-admin", JSON.stringify(v));
  }
  // Ακόμα και «/dashboard» που ο browser θα έστελνε αλλού δεν περνά.
  assert.equal(R.loginRedirectFor("STAFF", "//evil.com/dashboard"), "/dashboard");
  assert.equal(R.safeCallbackPath("/dashboard/x/../bookings"), "/dashboard/bookings", "κανονικοποίηση");
  // Κάθε αποτέλεσμα είναι σχετική διαδρομή της ίδιας εφαρμογής.
  for (const v of ["/dashboard", "/dashboard/fleet", ...bad]) {
    const out = R.loginRedirectFor("STAFF", v);
    assert.ok(out.startsWith("/") && !out.startsWith("//") && !out.includes("\\"), out);
  }
});

test("cross-tenant: η εταιρία του dashboard ΜΟΝΟ από το session, ποτέ από το site", () => {
  // Ο προορισμός δεν εξαρτάται από το site (κανένα slug/tenant στο αποτέλεσμα).
  for (const cb of [undefined, "/s/company-a/el", "/dashboard?tenant=company-a"]) {
    const out = R.loginRedirectFor("COMPANY_ADMIN", cb);
    assert.ok(out === "/dashboard" || out === "/dashboard?tenant=company-a", out);
  }
  // Το dashboard ΔΕΝ διαβάζει εταιρία από το URL: tenantId μόνο από το session.
  const login = read("src/app/api/auth/login/route.ts");
  assert.doesNotMatch(login, /storefront|resolveStorefront|referer|x-fleetpro-site-host/i, "το login δεν ξέρει από ποιο site ήρθε");
  assert.match(login, /tenantId: user\.tenantId,/);
  assert.match(login, /tenantSlug: user\.tenant\?\.slug \|\| null,/, "το slug του session = η εταιρία ΤΟΥ χρήστη");
  const layout = read("src/app/(dashboard)/dashboard/layout.tsx");
  assert.doesNotMatch(layout, /searchParams/, "το dashboard δεν παίρνει εταιρία από το URL");
  // Ο σύνδεσμος του site δεν κουβαλά την εταιρία του site.
  const views = read("src/components/storefront/StorefrontViews.tsx");
  assert.match(views, /const href = session \? roleHome\(session\.role\) : `\$\{company\.loginUrl\}\?lang=\$\{lang === "el" \? "el" : "en"\}`;/);
});

test("λάθος στοιχεία: ΕΝΑ γενικό μήνυμα για άγνωστο email και λάθος κωδικό", () => {
  const user = { isActive: true, emailVerifiedAt: new Date(), tenant: { status: "ACTIVE" } };
  assert.deepEqual(loginDecision(null, false), { ok: false, message: LOGIN_MSG.wrong });
  assert.deepEqual(loginDecision(user, false), { ok: false, message: LOGIN_MSG.wrong });
  assert.equal(LOGIN_MSG.wrong, "Λάθος email ή κωδικός");
  // Ανενεργός/αναστολή φαίνονται ΜΟΝΟ με σωστό κωδικό.
  assert.deepEqual(loginDecision({ ...user, isActive: false }, false), { ok: false, message: LOGIN_MSG.wrong });
  // Ίδιο API, ίδια όρια (ανά IP + κλείδωμα), bcrypt και για άγνωστο email.
  const api = read("src/app/api/auth/login/route.ts");
  assert.match(api, /hitLimit\(dbCounterStore, LIMITS\.loginPerIp, ip\)/);
  assert.match(api, /isLoginLocked\(dbLoginLockStore, email, ip\)/);
  assert.match(api, /user\?\.passwordHash \?\? DUMMY_HASH/);
});

test("σελίδα σύνδεσης: ίδιο flow· ήδη συνδεδεμένος (ενεργός στη βάση) → περιοχή του ρόλου", () => {
  const page = read("src/app/(auth)/login/page.tsx");
  assert.match(page, /const viewer = session \? await loadViewer\(session\) : null;/);
  assert.match(page, /if \(viewer\) redirect\(loginRedirectFor\(viewer\.role, callbackUrl\)\);/);
  const client = read("src/app/(auth)/login/LoginClient.tsx");
  assert.match(client, /fetch\("\/api\/auth\/login"/);
  assert.match(client, /window\.location\.href = data\.data\.redirectTo;/);
  // Κανένα δεύτερο σύστημα αυθεντικοποίησης.
  assert.doesNotMatch(read("package.json"), /next-auth/);
});

test("header του site: μενού «Είσοδος/Login» → «Σύνδεση/Sign in» ή «Dashboard», σε νέα καρτέλα, ΕΛ/EN", () => {
  assert.equal(storefrontDictionary("el").headerAccount, "Είσοδος");
  assert.equal(storefrontDictionary("en").headerAccount, "Login");
  assert.equal(storefrontDictionary("el").headerLogin, "Σύνδεση");
  assert.equal(storefrontDictionary("en").headerLogin, "Sign in");
  assert.equal(storefrontDictionary("el").headerDashboard, "Dashboard");
  assert.equal(storefrontDictionary("en").headerDashboard, "Dashboard");
  const views = read("src/components/storefront/StorefrontViews.tsx");
  assert.match(views, /<HeaderStaffMenu \{\.\.\.ctx\} \/>/);
  assert.match(views, /target: "_blank",\s+rel: "noopener nofollow",/);
  assert.match(views, /label: session \? d\.headerDashboard : d\.headerLogin,/);
  // Στο domain εταιρίας ΔΕΝ διαβάζεται cookie (δεν περνά εκεί) → πάντα «Σύνδεση».
  assert.match(views, /const session = onDomain \? null : await getSession\(\);/);
});

test("κανόνες συνδρομής όπως πριν: ο φύλακας του API δεν άλλαξε", () => {
  const api = read("src/lib/api.ts");
  assert.match(api, /viewer\.readOnly && !readOnlyAllows\(req\.method, req\.nextUrl\.pathname\)/);
});
