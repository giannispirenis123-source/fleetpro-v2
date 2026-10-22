// tests/self-signup.test.mjs
// Αυτόματη εγγραφή εταιρίας (SQL 34): slug από το όνομα, token επαλήθευσης,
// όρια, διακόπτες, σχήμα φόρμας, onboarding, φύλακες. Καθαρή λογική + ψεύτικα
// stores + στατικοί έλεγχοι — χωρίς βάση. Τρέχει με `npm test`.

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

const S = await import("../src/lib/signup/slug.ts");
const T = await import("../src/lib/signup/token.ts");
const F = await import("../src/lib/signup/flag.ts");
const U = await import("../src/lib/signup/signup.ts");
const O = await import("../src/lib/signup/onboarding.ts");
const R = await import("../src/lib/public/rateLimit.ts");
const L = await import("../src/lib/loginCore.ts");
const V = await import("../src/lib/viewerCore.ts");
const VIS = await import("../src/lib/storefront/visibility.ts");
const SLUG = await import("../src/lib/storefront/slug.ts");
const D = await import("../src/lib/storefront/domain.ts");

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* ── Slug ── */

test("slug: λατινοποίηση ελληνικών (τόνοι, θ/χ/ψ, ου/μπ/ντ/γκ)", () => {
  assert.equal(S.slugify("Ενοικιάσεις Χανιά"), "enoikiaseis-chania");
  assert.equal(S.slugify("Θησέας Ψαράς"), "thiseas-psaras");
  assert.equal(S.slugify("Μπάμπης & Ντίνος Γκαράζ"), "mpampis-and-ntinos-gkaraz");
  assert.equal(S.slugify("Κουκουλάκης ΑΕ"), "koukoulakis-ae");
  assert.equal(S.slugify("  P Rentals — Κίσαμος!! "), "p-rentals-kisamos");
  assert.equal(S.slugify("Café Ÿ ϊ"), "cafe-y-i");
});

test("slug: πάντα έγκυρη μορφή (3–40, a-z0-9-)", () => {
  for (const name of ["Α", "!!!", "", "x".repeat(200), "Ελληνική Εταιρία Ενοικίασης Αυτοκινήτων Κρήτης ΙΚΕ"]) {
    const base = S.slugBase(name);
    assert.match(base, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, name);
    assert.ok(base.length >= 3 && base.length <= 36, `${name} → ${base}`);
  }
  assert.equal(S.slugBase("!!!"), "company");
  assert.equal(S.slugBase("Α"), "a-rent");
});

test("slug: δεσμευμένες λέξεις παίρνουν επίθεμα (admin → admin-2)", async () => {
  for (const w of ["admin", "api", "app", "login", "signup", "www", "mail", "support", "dashboard", "verify-email", "onboarding", "legal"]) {
    assert.equal(SLUG.RESERVED_SLUGS.has(w), true, w);
    const s = await S.uniqueSlug(w, async () => false);
    assert.equal(s, `${w}-2`, w);
    assert.equal(SLUG.validateSlug(s).ok, true, s);
  }
  // s, c: κοντά → ποτέ ακριβώς αυτά
  for (const w of ["s", "c"]) assert.notEqual(await S.uniqueSlug(w, async () => false), w);
});

test("slug: σύγκρουση → αριθμητικό επίθεμα, μέσα στο όριο των 40", async () => {
  const taken = new Set(["chania-cars", "chania-cars-2", "chania-cars-3"]);
  assert.equal(await S.uniqueSlug("Chania Cars", async (s) => taken.has(s)), "chania-cars-4");
  const long = "Πολύ Μεγάλο Όνομα Εταιρίας Ενοικίασης Οχημάτων Χανίων";
  const base = S.slugBase(long);
  const s = await S.uniqueSlug(long, async (x) => x === base);
  assert.ok(s.length <= SLUG.SLUG_MAX, s);
  assert.match(s, /-2$/);
  // Όλα πιασμένα → τυχαίο επίθεμα, πάλι έγκυρο
  const r = await S.uniqueSlug("Chania Cars", async () => true, 5, () => "ab12z");
  assert.equal(r, "chania-cars-ab12z");
  assert.equal(SLUG.validateSlug(r).ok, true);
});

/* ── Token ── */

test("token: στη βάση μόνο το sha256 hash, όχι το ίδιο το token", () => {
  const now = new Date("2026-10-22T10:00:00Z");
  const t = T.createVerifyToken(now);
  assert.equal(T.isTokenShape(t.token), true);
  assert.match(t.tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(t.tokenHash, t.token);
  assert.equal(T.hashToken(t.token), t.tokenHash);
  assert.notEqual(T.createVerifyToken(now).token, t.token, "τυχαίο κάθε φορά");
});

test("token: λήξη σε 24 ώρες, μίας χρήσης", () => {
  const now = new Date("2026-10-22T10:00:00Z");
  const t = T.createVerifyToken(now);
  assert.equal(t.expiresAt.getTime() - now.getTime(), 24 * 3_600_000);
  const row = { expiresAt: t.expiresAt, usedAt: null };
  assert.equal(T.tokenState(row, now), "ok");
  assert.equal(T.tokenState(row, new Date(now.getTime() + 23.9 * 3_600_000)), "ok");
  assert.equal(T.tokenState(row, t.expiresAt), "expired");
  assert.equal(T.tokenState({ ...row, usedAt: now }, now), "used");
  assert.equal(T.tokenState(null, now), "invalid");
});

test("token: μορφή από το URL ελέγχεται πριν από οποιοδήποτε ερώτημα", () => {
  for (const bad of [null, undefined, "", "abc", "x".repeat(65), "a b".repeat(20), "<script>".repeat(6), 123]) {
    assert.equal(T.isTokenShape(bad), false, String(bad));
  }
  assert.equal(T.verifyUrl("https://app.example.gr/", "tok"), "https://app.example.gr/verify-email?token=tok");
});

/* ── Όρια ── */

function memoryStore() {
  const m = new Map();
  return {
    m,
    async increment(key, ws) {
      const k = `${key}|${ws.toISOString()}`;
      m.set(k, (m.get(k) ?? 0) + 1);
      return m.get(k);
    },
  };
}

test("όρια: 5 εγγραφές/ώρα ανά IP, 3 ανά email/ώρα (κοινός μηχανισμός LIMITS)", async () => {
  assert.deepEqual({ ...R.LIMITS.signupPerIp }, { scope: "signup-ip", max: 5, windowMinutes: 60 });
  assert.deepEqual({ ...R.LIMITS.signupPerEmail }, { scope: "signup-email", max: 3, windowMinutes: 60 });
  const store = memoryStore();
  const now = new Date("2026-10-22T10:05:00Z");
  const ip = [];
  for (let i = 0; i < 6; i++) ip.push(await R.hitLimit(store, R.LIMITS.signupPerIp, "1.2.3.4", now));
  assert.deepEqual(ip, [true, true, true, true, true, false]);
  const em = [];
  for (let i = 0; i < 4; i++) em.push(await R.hitLimit(store, R.LIMITS.signupPerEmail, "a@b.gr", now));
  assert.deepEqual(em, [true, true, true, false]);
  // Νέο παράθυρο → ξανά επιτρέπεται
  assert.equal(await R.hitLimit(store, R.LIMITS.signupPerEmail, "a@b.gr", new Date("2026-10-22T11:01:00Z")), true);
  // Κανένα email/IP σε καθαρή μορφή στα κλειδιά
  for (const k of store.m.keys()) assert.ok(!k.includes("a@b.gr") && !k.includes("1.2.3.4"), k);
});

test("όρια: «ξαναστείλε» και επαλήθευση έχουν δικά τους όρια", () => {
  assert.equal(R.LIMITS.verifyResendPerEmail.max, 3);
  assert.equal(R.LIMITS.verifyResendPerIp.max, 10);
  assert.equal(R.LIMITS.verifyPerIp.max, 30);
});

/* ── Διακόπτες ── */

test("διακόπτης: SELF_SIGNUP_ENABLED προεπιλογή OFF· μόνο true/1 ανοίγει", () => {
  assert.equal(F.selfSignupEnabled({}), false);
  for (const v of ["false", "0", "", "yes", "on"]) assert.equal(F.selfSignupEnabled({ SELF_SIGNUP_ENABLED: v }), false, v);
  for (const v of ["true", "TRUE", " 1 "]) assert.equal(F.selfSignupEnabled({ SELF_SIGNUP_ENABLED: v }), true, v);
});

test("test-only email hook: ΠΟΤΕ στο Vercel Production", () => {
  assert.equal(F.signupTestEmails({}), false);
  assert.equal(F.signupTestEmails({ SIGNUP_TEST_EMAILS: "1" }), true);
  assert.equal(F.signupTestEmails({ SIGNUP_TEST_EMAILS: "1", VERCEL_ENV: "preview" }), true);
  assert.equal(F.signupTestEmails({ SIGNUP_TEST_EMAILS: "1", VERCEL_ENV: "production" }), false);
});

/* ── Φόρμα ── */

const good = { companyName: "Χανιά Cars", ownerName: "Γιάννης Π.", email: "  Owner@Example.GR ", password: "12345678", acceptTerms: true };

test("φόρμα: email κανονικοποιείται (trim, πεζά), κωδικός ≥ 8, αποδοχή όρων υποχρεωτική", () => {
  const r = U.signupSchema.safeParse(good);
  assert.equal(r.success, true);
  assert.equal(r.data.email, "owner@example.gr");
  assert.equal(U.signupSchema.safeParse({ ...good, password: "1234567" }).success, false);
  assert.equal(U.signupSchema.safeParse({ ...good, acceptTerms: false }).success, false);
  assert.equal(U.signupSchema.safeParse({ ...good, acceptTerms: undefined }).success, false);
  assert.equal(U.signupSchema.safeParse({ ...good, email: "not-an-email" }).success, false);
  assert.equal(U.PASSWORD_MIN, 8);
});

test("φόρμα: ο client ΔΕΝ ορίζει ρόλο, εταιρία, πακέτο ή κατάσταση (πεδία αγνοούνται)", () => {
  const r = U.signupSchema.safeParse({ ...good, role: "SUPER_ADMIN", tenantId: "x", planKey: "full", status: "ACTIVE", emailVerifiedAt: "2020-01-01" });
  assert.equal(r.success, true);
  for (const k of ["role", "tenantId", "planKey", "status", "emailVerifiedAt"]) assert.equal(k in r.data, false, k);
});

test("honeypot: γεμάτο = bot", () => {
  assert.equal(U.isHoneypotFilled(undefined), false);
  assert.equal(U.isHoneypotFilled("   "), false);
  assert.equal(U.isHoneypotFilled("http://spam"), true);
});

test("email: ουδέτερο email σε υπάρχον λογαριασμό ΔΕΝ περιέχει σύνδεσμο επαλήθευσης", () => {
  const e = U.existingAccountEmail("el", "a@b.gr", "https://app/login");
  assert.match(e.subject, /Προσπάθεια εγγραφής/);
  assert.doesNotMatch(e.text + e.html, /verify-email|token=/);
  const v = U.verificationEmail("en", "a@b.gr", "<b>Jo</b>", "https://app/verify-email?token=abc");
  assert.match(v.html, /token=abc/);
  assert.doesNotMatch(v.html, /<b>Jo<\/b>/, "όνομα escaped στο HTML");
  assert.match(v.text, /24 hours/);
});

test("καμία τιμή/ποσό/πλάνο στα κείμενα της εγγραφής", () => {
  for (const f of ["src/lib/signup/signup.ts", "src/lib/signup/onboarding.ts", "src/app/(auth)/signup/SignupClient.tsx", "src/app/(dashboard)/dashboard/onboarding/OnboardingClient.tsx"]) {
    assert.doesNotMatch(read(f), /€|\bEUR\b|\/μήνα|per month|τιμή συνδρομής|pricing plan/i, f);
  }
});

/* ── Onboarding ── */

test("onboarding: «έγινε» από τα πραγματικά δεδομένα· banner μέχρι Α, Β, Δ", () => {
  const s0 = O.initialOnboardingState(new Date("2026-10-22T10:00:00Z"));
  const none = { vehicles: 0, stripeConnected: false, published: false, hasDomain: false };
  let v = O.onboardingView(s0, none);
  assert.equal(v.complete, false);
  assert.equal(v.requiredDone, 0);
  assert.equal(v.requiredTotal, 3);
  const s1 = O.applyOnboardingAction(s0, "company", "done");
  v = O.onboardingView(s1, { ...none, vehicles: 1 });
  assert.equal(v.requiredDone, 2);
  v = O.onboardingView(s1, { ...none, vehicles: 1, published: true });
  assert.equal(v.complete, true, "Γ, Ε προαιρετικά");
});

test("onboarding: «έγινε» μόνο για το Α· παράλειψη/επαναφορά για όλα", () => {
  const s0 = O.initialOnboardingState();
  for (const step of ["vehicle", "payments", "publish", "domain"]) assert.equal(O.applyOnboardingAction(s0, step, "done"), null, step);
  const sk = O.applyOnboardingAction(s0, "payments", "skip");
  assert.deepEqual(sk.skipped, ["payments"]);
  assert.equal(O.onboardingView(sk, { vehicles: 0, stripeConnected: false, published: false, hasDomain: false }).steps[2].skipped, true);
  assert.deepEqual(O.applyOnboardingAction(sk, "payments", "unskip").skipped, []);
  // Η παράλειψη ΔΕΝ ολοκληρώνει υποχρεωτικό βήμα
  const skipAll = ["company", "vehicle", "publish"].reduce((s, k) => O.applyOnboardingAction(s, k, "skip"), s0);
  assert.equal(O.onboardingView(skipAll, { vehicles: 0, stripeConnected: false, published: false, hasDomain: false }).complete, false);
});

test("onboarding: άκυρο jsonb → null ή καθαρή κατάσταση", () => {
  assert.equal(O.normalizeOnboardingState(null), null);
  assert.equal(O.normalizeOnboardingState([]), null);
  const n = O.normalizeOnboardingState({ done: { company: "x", hack: "y" }, skipped: ["domain", "evil"] });
  assert.deepEqual(n.done, { company: "x" });
  assert.deepEqual(n.skipped, ["domain"]);
});

/* ── Φύλακες: ανεπιβεβαίωτος = ούτε login ούτε dashboard ούτε δημόσια σελίδα ── */

test("login: σωστός κωδικός αλλά email χωρίς επαλήθευση → όχι σύνδεση (code unverified)", () => {
  const u = { isActive: true, emailVerifiedAt: null, tenant: { status: "TRIAL" } };
  const d = L.loginDecision(u, true);
  assert.equal(d.ok, false);
  assert.equal(d.code, "unverified");
  // Λάθος κωδικός → ΙΔΙΟ μήνυμα με άγνωστο email (καμία αποκάλυψη)
  assert.equal(L.loginDecision(u, false).message, L.LOGIN_MSG.wrong);
  assert.equal(L.loginDecision({ ...u, emailVerifiedAt: new Date() }, true).ok, true);
  // Παλιοί χρήστες (backfill) / χωρίς πεδίο → όπως πριν
  assert.equal(L.loginDecision({ isActive: true, tenant: { status: "ACTIVE" } }, true).ok, true);
});

test("φύλακας API/dashboard: emailVerifiedAt = null → απόρριψη", () => {
  const row = { id: "u1", role: "COMPANY_ADMIN", tenantId: "t1", isActive: true, permissions: {}, tenant: { status: "TRIAL" } };
  assert.ok(V.acceptViewerRow({ ...row, emailVerifiedAt: new Date() }, { userId: "u1", tenantId: "t1" }));
  assert.equal(V.acceptViewerRow({ ...row, emailVerifiedAt: null }, { userId: "u1", tenantId: "t1" }), null);
});

test("δημόσια σελίδα: εγγραφή χωρίς επαληθευμένο email → κλειστή (404)", () => {
  const base = { storefrontSlug: "x-cars", storefrontEnabled: true, status: "TRIAL", publicSite: true };
  assert.deepEqual(VIS.storefrontVisibility({ ...base, pendingVerification: true }), { open: false, reason: "unverified" });
  assert.deepEqual(VIS.storefrontVisibility(base), { open: true });
  const plan = { key: "full", name: "Full", modules: { dashboard: true, publicSite: true }, limits: {} };
  const row = { storefrontSlug: "x-cars", storefrontEnabled: true, status: "TRIAL", entitlementPlan: plan, entitlementOverrides: {} };
  assert.equal(VIS.storefrontRowVisibility({ ...row, signupSource: "self_signup", _count: { users: 0 } }).open, false);
  assert.equal(VIS.storefrontRowVisibility({ ...row, signupSource: "self_signup", _count: { users: 1 } }).open, true);
  // Εταιρίες του Super Admin: ποτέ «unverified»
  assert.equal(VIS.storefrontRowVisibility({ ...row, signupSource: "manual", _count: { users: 0 } }).open, true);
  assert.ok(VIS.HIDDEN_REASON_TEXT.unverified.el);
});

test("domain εταιρίας: /signup, /verify-email, /legal → 404 (μόνο στην πλατφόρμα)", () => {
  for (const p of ["/signup", "/verify-email", "/legal/terms"]) assert.equal(D.routeCustomDomain(p).kind, "notFound", p);
});

/* ── Στατικοί έλεγχοι: διακόπτης, ένας μηχανισμός δημιουργίας, SQL ── */

test("διακόπτης OFF: σελίδες notFound() και endpoints 404 ΠΡΙΝ από οτιδήποτε άλλο", () => {
  for (const p of ["src/app/(auth)/signup/page.tsx", "src/app/(auth)/verify-email/page.tsx"]) {
    assert.match(read(p), /if \(!selfSignupEnabled\(\)\) notFound\(\);/, p);
  }
  for (const r of ["signup", "verify-email", "resend-verification"]) {
    const src = read(`src/app/api/auth/${r}/route.ts`);
    assert.match(src, /export async function POST\(req: NextRequest\) \{\n  if \(!selfSignupEnabled\(\)\) return signupOff\(\);/, r);
  }
  // Ο σύνδεσμος στο login μόνο με τον διακόπτη
  assert.match(read("src/app/(auth)/login/page.tsx"), /signupEnabled=\{selfSignupEnabled\(\)\}/);
  assert.match(read("src/app/(auth)/login/LoginClient.tsx"), /\{signupEnabled \? \(\s*<a href=\{`\/signup/);
});

test("ΕΝΑΣ μηχανισμός δημιουργίας εταιρίας: Super Admin και εγγραφή μέσω createTenantWithAdmin", () => {
  const sa = read("src/app/api/tenants/route.ts");
  const su = read("src/lib/signup/signupServer.ts");
  assert.match(sa, /createTenantWithAdmin\(tx,/);
  assert.match(su, /createTenantWithAdmin\(tx,/);
  assert.doesNotMatch(sa + su, /tx\.tenant\.create|tx\.user\.create|db\.tenant\.create|db\.user\.create/);
  const core = read("src/lib/tenantCreate.ts");
  assert.match(core, /role: "COMPANY_ADMIN"/);
  assert.match(core, /status: "TRIAL"/);
  // Ίδιο hashing με το υπόλοιπο σύστημα
  assert.match(su, /bcrypt\.hash\(input\.password, BCRYPT_ROUNDS\)/);
  assert.match(core, /BCRYPT_ROUNDS = 12/);
});

test("εγγραφή: εταιρία + χρήστης + token σε ΜΙΑ transaction, χρήστης ανεπιβεβαίωτος", () => {
  const su = read("src/lib/signup/signupServer.ts");
  const tx = su.slice(su.indexOf("await db.$transaction(async (tx) => {"), su.indexOf("} catch (e) {"));
  assert.match(tx, /createTenantWithAdmin/);
  assert.match(tx, /emailVerifiedAt: null/);
  assert.match(tx, /signupSource: "self_signup"/);
  assert.match(tx, /tx\.emailVerificationToken\.create/);
  // Επαλήθευση: ατομική κατανάλωση με όλους τους όρους
  assert.match(su, /where: \{ id: row\.id, usedAt: null, expiresAt: \{ gt: now \} \}/);
});

test("SQL 34: idempotent, backfill μόνο κατά την προσθήκη της στήλης, verification με αναμενόμενο", () => {
  const sql = read("prisma/sql/34-self-signup.sql");
  assert.match(sql, /IF NOT EXISTS \(\s*SELECT 1 FROM information_schema\.columns[\s\S]*?'emailVerifiedAt'[\s\S]*?UPDATE "users" SET "emailVerifiedAt"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "email_verification_tokens"/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "email_verification_tokens_tokenHash_key"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "signupSource" TEXT NOT NULL DEFAULT 'manual'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "onboardingState" JSONB/);
  assert.match(sql, /unverified_users = 0/);
  // Κανένα UPDATE στο users εκτός του block της πρώτης εκτέλεσης
  assert.equal((sql.match(/UPDATE "users"/g) ?? []).length, 1);
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /emailVerifiedAt DateTime\? @default\(now\(\)\)/);
  assert.match(schema, /@@map\("email_verification_tokens"\)/);
});

test("CSRF: τα POST της εγγραφής δέχονται ΜΟΝΟ application/json (preflight για ξένες σελίδες)", async () => {
  const Q = U;
  const req = (ct) => new Request("http://x/api", { method: "POST", headers: ct ? { "content-type": ct } : {} });
  assert.equal(Q.isJsonRequest(req("application/json")), true);
  assert.equal(Q.isJsonRequest(req("application/json; charset=utf-8")), true);
  for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", null]) {
    assert.equal(Q.isJsonRequest(req(ct)), false, String(ct));
  }
  for (const r of ["signup", "verify-email", "resend-verification"]) {
    assert.match(read(`src/app/api/auth/${r}/route.ts`), /if \(!isJsonRequest\(req\)\) return notJson\(\);/, r);
  }
});
