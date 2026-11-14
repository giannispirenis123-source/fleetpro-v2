// tests/support-email.test.mjs — email υποστήριξης ΜΟΝΟ από το env
// NEXT_PUBLIC_SUPPORT_EMAIL· χωρίς αυτό ο σύνδεσμος «Επικοινωνία» κρύβεται.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const { parseSupportEmail } = await import("../src/lib/supportEmail.ts");
const ROOT = new URL("../", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");

test("parseSupportEmail: έγκυρη διεύθυνση (πεζά, χωρίς κενά)· κενό/άκυρο/επικίνδυνο → null", () => {
  assert.equal(parseSupportEmail("  Help@Example.COM "), "help@example.com");
  assert.equal(parseSupportEmail("x@example.com\n"), "x@example.com", "κενά/αλλαγή γραμμής από αντιγραφή κόβονται");
  assert.equal(parseSupportEmail("x@exam\nple.com"), null);
  for (const bad of [undefined, null, "", "   ", "not-an-email", "a@b", "a b@example.com", 'x"@example.com', "x@example.com?subject=hi", "<x@example.com>", "javascript:alert(1)"]) {
    assert.equal(parseSupportEmail(bad), null, JSON.stringify(bad));
  }
});

test("καμία σκληρογραμμένη διεύθυνση υποστήριξης στον κώδικα· μόνο το env", () => {
  const files = [];
  const walk = (d) =>
    readdirSync(d).forEach((n) => {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) files.push(p);
    });
  walk(join(ROOT, "src"));
  for (const f of files) {
    const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /mailto:[\w.+-]+@/, f);
    assert.doesNotMatch(code, /support@[\w-]+\.[a-z]+/i, f);
  }
  assert.match(read("src/lib/supportEmail.ts"), /parseSupportEmail\(process\.env\.NEXT_PUBLIC_SUPPORT_EMAIL\)/);
  assert.match(read(".env.example"), /^NEXT_PUBLIC_SUPPORT_EMAIL=$/m, "στο .env.example ΧΩΡΙΣ τιμή");
});

test("login: ο σύνδεσμος «Επικοινωνία» υπάρχει ΜΟΝΟ με email· Super Admin: δείχνει το env ή «δεν έχει οριστεί»", () => {
  const login = read("src/app/(auth)/login/LoginClient.tsx");
  assert.match(login, /\{\(signupEnabled \|\| SUPPORT_EMAIL\) && \(/);
  assert.match(login, /href=\{`mailto:\$\{SUPPORT_EMAIL\}`\}/);
  const sa = read("src/app/(super-admin)/super-admin/page.tsx");
  assert.match(sa, /value=\{SUPPORT_EMAIL \?\? "— δεν έχει οριστεί \(NEXT_PUBLIC_SUPPORT_EMAIL\) —"\}/);
});
