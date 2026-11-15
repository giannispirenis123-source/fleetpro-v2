// tests/password-reset.test.mjs — «Ξέχασα τον κωδικό μου» + ακύρωση συνδέσεων
// μετά από αλλαγή κωδικού (SQL 41).

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

const R = await import("../src/lib/passwordReset.ts");
const V = await import("../src/lib/viewerCore.ts");
const T = await import("../src/lib/signup/token.ts");
const { LIMITS, hitLimit } = await import("../src/lib/public/rateLimit.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* ── Token ── */

test("token: 32 τυχαία bytes, στη βάση ΜΟΝΟ το hash, λήξη 60΄, μίας χρήσης", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  const a = R.createResetToken(now);
  const b = R.createResetToken(now);
  assert.notEqual(a.token, b.token);
  assert.ok(T.isTokenShape(a.token));
  assert.equal(a.tokenHash, T.hashToken(a.token));
  assert.notEqual(a.tokenHash, a.token);
  assert.match(a.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(a.expiresAt.getTime() - now.getTime(), 60 * 60_000);
  const row = { expiresAt: a.expiresAt, usedAt: null };
  assert.equal(T.tokenState(row, new Date("2026-11-15T10:59:59Z")), "ok");
  assert.equal(T.tokenState(row, new Date("2026-11-15T11:00:00Z")), "expired");
  assert.equal(T.tokenState({ ...row, usedAt: now }, now), "used");
  assert.equal(T.tokenState(null, now), "invalid");
  assert.equal(R.resetUrl("https://kratisi.eu/", a.token, "el"), `https://kratisi.eu/reset-password?token=${a.token}`);
  assert.match(R.resetUrl("https://kratisi.eu", a.token, "en"), /&lang=en$/);
});

test("schemas: email κανονικοποιείται· token μόνο σωστής μορφής· κωδικός ≥ 8· ξένα πεδία αγνοούνται", () => {
  assert.equal(R.forgotSchema.parse({ email: "  Maria@Example.COM " }).email, "maria@example.com");
  assert.equal(R.forgotSchema.safeParse({ email: "nope" }).success, false);
  const tok = R.createResetToken().token;
  assert.equal(R.resetSchema.safeParse({ token: tok, password: "12345678" }).success, true);
  assert.equal(R.resetSchema.safeParse({ token: tok, password: "1234567" }).success, false);
  for (const bad of ["", "short", "a b".repeat(20), `${tok}/../x`, "x".repeat(65)]) assert.equal(R.resetSchema.safeParse({ token: bad, password: "12345678" }).success, false, bad);
  const parsed = R.resetSchema.parse({ token: tok, password: "12345678", userId: "u1", email: "x@y.gr", role: "SUPER_ADMIN" });
  for (const k of ["userId", "email", "role"]) assert.equal(k in parsed, false, k);
});

test("ποιος παίρνει σύνδεσμο: ενεργός, επαληθευμένος, εταιρία όχι σε αναστολή/ακυρωμένη", () => {
  const u = (o = {}) => ({ isActive: true, emailVerifiedAt: new Date(), tenant: { status: "ACTIVE" }, ...o });
  assert.equal(R.canReceiveReset(u()), true);
  assert.equal(R.canReceiveReset(u({ tenant: null })), true, "Super Admin (χωρίς εταιρία)");
  assert.equal(R.canReceiveReset(u({ tenant: { status: "TRIAL" } })), true);
  assert.equal(R.canReceiveReset(null), false);
  assert.equal(R.canReceiveReset(u({ isActive: false })), false);
  assert.equal(R.canReceiveReset(u({ emailVerifiedAt: null })), false);
  assert.equal(R.canReceiveReset(u({ tenant: { status: "SUSPENDED" } })), false);
  assert.equal(R.canReceiveReset(u({ tenant: { status: "CANCELLED" } })), false);
});

test("email: σύνδεσμος, λήξη, ΕΛ/EN· κανένα στοιχείο πέρα από το όνομα· HTML με escape", () => {
  const url = "https://kratisi.eu/reset-password?token=abc";
  const el = R.resetEmail("el", "m@example.com", "Μαρία <b>", url);
  const en = R.resetEmail("en", "m@example.com", "Maria", url);
  assert.equal(el.to, "m@example.com");
  assert.equal(el.subject, "Νέος κωδικός — Kratisi");
  assert.equal(en.subject, "Reset your password — Kratisi");
  for (const m of [el, en]) {
    assert.ok(m.text.includes(url) && m.html.includes(url));
    assert.match(m.text, /60/);
    assert.doesNotMatch(m.text + m.html, /m@example\.com|FleetPro/);
    assert.doesNotMatch(m.text + m.subject, /€|\d+[.,]\d{2}/, "κανένα ποσό στο email");
  }
  assert.ok(el.html.includes("Μαρία &lt;b&gt;") && !el.html.includes("<b>"));
});

/* ── Καμία απαρίθμηση λογαριασμών ── */

test("«στείλε σύνδεσμο»: ΙΔΙΑ απάντηση για κάθε email, όριο email σιωπηλό, ελάχιστος χρόνος, τίποτα στα logs", () => {
  const s = read("src/lib/passwordResetServer.ts");
  const flow = s.slice(s.indexOf("export async function requestReset"), s.indexOf("export async function performReset"));
  // Μία μόνο επιτυχής έξοδος — η ουδέτερη — ό,τι κι αν βρέθηκε στη βάση.
  assert.equal((flow.match(/return \{ status: 200/g) ?? []).length, 1);
  assert.match(flow, /return \{ status: 200, message: RESET_MESSAGES\.neutral\[lang\] \};/);
  assert.doesNotMatch(flow, /status: 40[04]/);
  assert.match(flow, /if \(emailOk && user && canReceiveReset\(user\)\)/);
  assert.equal((flow.match(/await pad\(started\);/g) ?? []).length, 2, "και στο 429 και στην κανονική απάντηση");
  assert.match(s, /FORGOT_MIN_RESPONSE_MS = 1500/);
  // Νέο αίτημα ακυρώνει τα παλιά tokens· στη βάση μόνο hash.
  assert.match(flow, /passwordResetToken\.deleteMany\(\{ where: \{ userId: user\.id \} \}\)/);
  assert.match(flow, /tokenHash: t\.tokenHash/);
  assert.doesNotMatch(s, /console\.\w+\([^)]*(\$\{email\}|\$\{token\}|\.to\b|url)/);
  assert.match(R.RESET_MESSAGES.neutral.el, /^Αν υπάρχει λογαριασμός/);
  assert.match(R.RESET_MESSAGES.neutral.en, /^If an account exists/);
  const route = read("src/app/api/auth/forgot-password/route.ts");
  assert.match(route, /requestReset\(parsed\.data\.email, parsed\.data\.lang, clientIp\(req\), linkOrigin\(publicOrigin\(req\)\)\)/);
});

test("όρια: 5/15΄ ανά IP (αίτημα), 3/ώρα ανά email, 10/15΄ ανά IP (επαναφορά)", async () => {
  assert.deepEqual(LIMITS.passwordForgotPerIp, { scope: "pw-forgot-ip", max: 5, windowMinutes: 15 });
  assert.deepEqual(LIMITS.passwordForgotPerEmail, { scope: "pw-forgot-email", max: 3, windowMinutes: 60 });
  assert.deepEqual(LIMITS.passwordResetPerIp, { scope: "pw-reset-ip", max: 10, windowMinutes: 15 });
  const counts = new Map();
  const store = { increment: async (k, w) => { const key = `${k}|${w.toISOString()}`; counts.set(key, (counts.get(key) ?? 0) + 1); return counts.get(key); } };
  const now = new Date("2026-11-15T10:00:00Z");
  for (let i = 0; i < 5; i++) assert.equal(await hitLimit(store, LIMITS.passwordForgotPerIp, "1.2.3.4", now), true);
  assert.equal(await hitLimit(store, LIMITS.passwordForgotPerIp, "1.2.3.4", now), false);
});

test("επαναφορά: token μίας χρήσης ΑΤΟΜΙΚΑ, ίδιο μήνυμα για άκυρο/ληγμένο/χρησιμοποιημένο, καμία αυτόματη σύνδεση", () => {
  const s = read("src/lib/passwordResetServer.ts");
  const flow = s.slice(s.indexOf("export async function performReset"));
  assert.match(flow, /where: \{ tokenHash: hashToken\(token\) \}/);
  assert.match(flow, /if \(!row \|\| tokenState\(row, now\) !== "ok" \|\| !canReceiveReset\(row\.user\)\) return bad;/);
  assert.match(flow, /where: \{ id: row\.id, usedAt: null, expiresAt: \{ gt: now \} \},\s*data: \{ usedAt: now \}/);
  assert.match(flow, /if \(used\.count !== 1\) return false;/);
  assert.ok(flow.indexOf("used.count !== 1") < flow.indexOf("tx.user.update"), "ο κωδικός αλλάζει ΜΟΝΟ αν κέρδισε το token");
  assert.match(flow, /data: \{ passwordHash, passwordChangedAt: passwordChangeStamp\(now\) \}/);
  const route = read("src/app/api/auth/reset-password/route.ts");
  assert.doesNotMatch(route + s, /setSessionCookie|signToken/);
});

/* ── Ακύρωση συνδέσεων ── */

test("σύνδεση που εκδόθηκε ΠΡΙΝ από την αλλαγή κωδικού απορρίπτεται· μετά (και στο ίδιο δευτερόλεπτο) περνά", () => {
  const changed = V.passwordChangeStamp(new Date("2026-11-15T10:00:00.700Z"));
  assert.equal(changed.toISOString(), "2026-11-15T10:00:00.000Z", "στρογγύλεμα προς τα κάτω σε δευτερόλεπτο");
  const sec = changed.getTime() / 1000;
  assert.equal(V.issuedBeforePasswordChange(sec - 1, changed), true);
  assert.equal(V.issuedBeforePasswordChange(sec - 86400, changed), true);
  assert.equal(V.issuedBeforePasswordChange(sec, changed), false, "το νέο cookie της ίδιας στιγμής");
  assert.equal(V.issuedBeforePasswordChange(sec + 5, changed), false);
  assert.equal(V.issuedBeforePasswordChange(undefined, changed), true, "token χωρίς iat με αλλαγμένο κωδικό");
  for (const never of [null, undefined]) assert.equal(V.issuedBeforePasswordChange(sec - 999, never), false, "χωρίς αλλαγή: όλα όπως πριν");

  const row = (o = {}) => ({ id: "u1", role: "STAFF", tenantId: "t1", isActive: true, emailVerifiedAt: new Date(), permissions: {}, tenant: { status: "ACTIVE" }, ...o });
  const sess = (iat) => ({ userId: "u1", tenantId: "t1", iat });
  assert.ok(V.acceptViewerRow(row(), sess(sec - 100)), "χωρίς passwordChangedAt: καμία αλλαγή συμπεριφοράς");
  assert.ok(V.acceptViewerRow(row({ passwordChangedAt: null }), sess(sec - 100)));
  assert.equal(V.acceptViewerRow(row({ passwordChangedAt: changed }), sess(sec - 100)), null);
  assert.ok(V.acceptViewerRow(row({ passwordChangedAt: changed }), sess(sec + 1)));
});

test("κάθε σημείο που γράφει κωδικό σημαδεύει το passwordChangedAt· το loadViewer το διαβάζει· το iat δεν αντιγράφεται", () => {
  for (const f of ["src/app/api/users/me/password/route.ts", "src/app/api/users/[id]/password/route.ts", "src/app/api/company-users/[id]/route.ts", "src/lib/passwordResetServer.ts"]) {
    assert.match(read(f), /passwordChangedAt: passwordChangeStamp\(/, f);
  }
  assert.match(read("src/lib/viewer.ts"), /passwordChangedAt: true,/);
  assert.match(read("src/lib/viewerCore.ts"), /if \(issuedBeforePasswordChange\(session\.iat, row\.passwordChangedAt\)\) return null;/);
  // Ο ίδιος ο χρήστης μένει συνδεδεμένος στη συσκευή του (νέο cookie μετά την αλλαγή).
  assert.match(read("src/app/api/users/me/password/route.ts"), /await setSessionCookie\(response, \{/);
  assert.match(read("src/lib/auth.ts"), /const \{ iat: _iat, \.\.\.claims \} = payload;/);
});

/* ── Σελίδες, middleware, SQL ── */

test("σελίδες δημόσιες με noindex/no-store/no-referrer· σύνδεσμος στο login· ποτέ στο domain εταιρίας", () => {
  const mw = read("src/middleware.ts");
  assert.match(mw, /PASSWORD_RESET_ROUTE_RE = \/\^\\\/\(forgot-password\|reset-password\)\\\/\?\$\//);
  assert.match(mw, /if \(SIGNUP_ROUTE_RE\.test\(pathname\) \|\| PASSWORD_RESET_ROUTE_RE\.test\(pathname\)\) \{/);
  assert.match(read("src/app/(auth)/login/LoginClient.tsx"), /href=\{`\/forgot-password\?lang=\$\{locale\}`\}/);
  assert.match(read("src/lib/storefront/domain.ts"), /legal\|forgot-password\|reset-password\)\$/);
  assert.match(read("src/app/(auth)/reset-password/page.tsx"), /isTokenShape\(searchParams\.token\) \? searchParams\.token : null/);
  for (const k of ["forgotTitle", "sendLink", "resetTitle", "mismatch", "loginLink"]) {
    assert.match(read("src/lib/i18n/el.ts"), new RegExp(`\\b${k}: "`), k);
    assert.match(read("src/lib/i18n/en.ts"), new RegExp(`\\b${k}: "`), k);
  }
});

test("SQL 41: μόνο προσθήκη (nullable στήλη, νέος πίνακας με FK CASCADE), idempotent, transaction, verification", () => {
  const sql = read("prisma/sql/41-password-reset.sql");
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
  assert.match(sql, /ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP\(3\);/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "password_reset_tokens"/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_tokenHash_key"/);
  assert.match(sql, /FOREIGN KEY \("userId"\) REFERENCES "users"\("id"\) ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /DROP |DELETE FROM|UPDATE "|SET NOT NULL|"passwordChangedAt" TIMESTAMP\(3\) NOT NULL/);
  assert.match(sql, /-- Verification/);
  assert.match(sql, /AS users_with_stamp/);
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /passwordChangedAt DateTime\?/);
  assert.match(schema, /model PasswordResetToken \{[\s\S]*?tokenHash String\s+@unique[\s\S]*?onDelete: Cascade\)[\s\S]*?@@map\("password_reset_tokens"\)/);
});
