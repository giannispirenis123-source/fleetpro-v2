// tests/support-email-copy.test.mjs — η διεύθυνση υποστήριξης φαίνεται ως
// κείμενο (mailto) με κουμπί «Αντιγραφή»· χωρίς env όλο το μπλοκ κρύβεται.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const comp = read("src/components/SupportEmailCopy.tsx");
const login = read("src/app/(auth)/login/LoginClient.tsx");
const sa = read("src/app/(super-admin)/super-admin/page.tsx");

test("component: ορατή διεύθυνση ως mailto, κουμπί «Αντιγραφή» με clipboard, αθόρυβο fallback, επιβεβαίωση", () => {
  assert.match(comp, /href=\{`mailto:\$\{email\}`\}/);
  assert.match(comp, />\s*\{email\}\s*<\/a>/, "η διεύθυνση ως ορατό κείμενο");
  assert.match(comp, /user-select: all/, "επιλέγεται με ένα κλικ");
  assert.match(comp, /await navigator\.clipboard\.writeText\(email\)/);
  assert.match(comp, /if \(!navigator\.clipboard\?\.writeText\) throw/);
  assert.match(comp, /\} catch \{\s*\/\/ Αθόρυβο fallback[^\n]*\n\s*selectText\(addrRef\.current\);/);
  assert.doesNotMatch(comp, /alert\(|console\./, "κανένα μήνυμα σφάλματος στον χρήστη");
  assert.match(comp, /role="status" aria-live="polite"/);
  assert.match(comp, /\{copied \? labels\.copied : labels\.copy\}/);
  assert.match(comp, /type="button"/, "δεν υποβάλλει φόρμα");
  assert.doesNotMatch(comp, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, "καμία σκληρογραμμένη διεύθυνση");
});

test("login: σύνδεσμος «Επικοινωνήστε» + ορατή διεύθυνση με «Αντιγραφή» ΜΟΝΟ με SUPPORT_EMAIL", () => {
  assert.match(login, /<p>\{tr\("auth\.noAccount"\)\}<\/p>/);
  assert.match(login, /href=\{`mailto:\$\{SUPPORT_EMAIL\}`\} data-testid="login-contact">\{tr\("auth\.contactUs"\)\}/);
  assert.match(login, /\{!signupEnabled && SUPPORT_EMAIL && \(\s*<div className="login-support"/);
  assert.match(login, /labels=\{\{ copy: tr\("auth\.copyEmail"\), copied: tr\("auth\.emailCopied"\) \}\}/);
  assert.match(login, /__html: loginStyles \+ SUPPORT_EMAIL_STYLES/);
});

test("Super Admin: η ίδια λύση (κείμενο + «Αντιγραφή») ή «δεν έχει οριστεί»", () => {
  assert.match(sa, /<SupportEmailCopy email=\{SUPPORT_EMAIL\} labels=\{\{ copy: tr\("auth\.copyEmail"\), copied: tr\("auth\.emailCopied"\) \}\}/);
  assert.match(sa, /__html: superAdminStyles \+ SUPPORT_EMAIL_STYLES/);
});

test("i18n: «Αντιγραφή» / «Αντιγράφηκε» σε ΕΛ και EN", () => {
  assert.match(read("src/lib/i18n/el.ts"), /copyEmail: "Αντιγραφή",\s*emailCopied: "Αντιγράφηκε",/);
  assert.match(read("src/lib/i18n/en.ts"), /copyEmail: "Copy",\s*emailCopied: "Copied",/);
});
