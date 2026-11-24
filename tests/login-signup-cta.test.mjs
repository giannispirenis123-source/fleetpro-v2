// tests/login-signup-cta.test.mjs — login: «Δημιουργία λογαριασμού» (μόνο με
// ανοιχτή εγγραφή) και «Χρειάζεστε βοήθεια;» (μόνο με email υποστήριξης) είναι
// ΑΝΕΞΑΡΤΗΤΑ μπλοκ. Κανένα env δεν αλλάζει εδώ.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const login = read("src/app/(auth)/login/LoginClient.tsx");
const el = read("src/lib/i18n/el.ts");
const en = read("src/lib/i18n/en.ts");

test("εγγραφή: διαχωριστικό «ή» + ΠΛΗΡΕΣ κουμπί προς /signup?lang=<locale> + υπότιτλος, ΜΟΝΟ με signupEnabled", () => {
  assert.match(login, /\{signupEnabled && \(\s*<div className="login-signup" data-testid="login-signup">/);
  assert.match(login, /<div className="login-or" role="separator" aria-label=\{tr\("auth\.orDivider"\)\}>/);
  assert.match(login, /<a className="login-btn-secondary" href=\{`\/signup\?lang=\$\{locale\}`\} data-testid="login-create-account">\s*\{tr\("auth\.createAccount"\)\}/);
  assert.match(login, /<p className="login-signup-sub">\{tr\("auth\.createAccountHint"\)\}<\/p>/);
  // Ίδιο ύψος με το «Σύνδεση», full width, δευτερεύον (περίγραμμα, όχι γέμισμα).
  assert.match(login, /\.login-btn \{[\s\S]*?min-height: 46px;/);
  assert.match(login, /\.login-btn-secondary \{[\s\S]*?min-height: 46px;[\s\S]*?width: 100%;[\s\S]*?border: 1\.5px solid var\(--primary\); background: var\(--surface\); color: var\(--primary-soft\);/);
  assert.match(login, /\.login-btn-secondary:hover \{/);
  assert.match(login, /\.login-btn-secondary:focus-visible/);
});

test("βοήθεια: ανεξάρτητη από την εγγραφή — μόνο με SUPPORT_EMAIL", () => {
  assert.match(login, /\{SUPPORT_EMAIL && \(\s*<div className="login-help" data-testid="login-support">/);
  assert.doesNotMatch(login, /!signupEnabled && SUPPORT_EMAIL/, "δεν κρύβεται πια όταν υπάρχει εγγραφή");
  assert.doesNotMatch(login, /signupEnabled \|\| SUPPORT_EMAIL/, "κανένα κοινό μπλοκ");
  assert.match(login, /<SupportEmailCopy\s+email=\{SUPPORT_EMAIL\}/);
  // Διακριτικό: μικρό, απαλό χρώμα.
  assert.match(login, /\.login-help \{[\s\S]*?font-size: 12px; color: var\(--text-4\);/);
});

test("i18n: όλα τα νέα κείμενα σε ΕΛ και EN· ο υπότιτλος δεν υπόσχεται «δωρεάν»", () => {
  const keys = { orDivider: ["ή", "or"], createAccount: ["Δημιουργία λογαριασμού", "Create an account"], createAccountHint: ["Φτιάξτε την εταιρία σας σε λίγα λεπτά.", "Set up your company in a few minutes."], needHelp: ["Χρειάζεστε βοήθεια;", "Need help?"] };
  for (const [k, [g, e]] of Object.entries(keys)) {
    assert.ok(el.includes(`    ${k}: "${g}",`), `el ${k}`);
    assert.ok(en.includes(`    ${k}: "${e}",`), `en ${k}`);
  }
  assert.doesNotMatch(el + en, /createAccountHint: "[^"]*(δωρεάν|free)/i);
});

test("κανένα env ή διακόπτης δεν αλλάζει εδώ: η εγγραφή μένει πίσω από το SELF_SIGNUP_ENABLED", () => {
  assert.match(read("src/lib/signup/flag.ts"), /return on\(env\.SELF_SIGNUP_ENABLED\);/);
  assert.match(read("src/app/(auth)/login/page.tsx"), /selfSignupEnabled\(\)/);
  assert.doesNotMatch(login, /process\.env\.SELF_SIGNUP/);
});
