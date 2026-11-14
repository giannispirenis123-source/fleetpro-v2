// tests/no-demo-passwords.test.mjs — κανένας σταθερός κωδικός (ή bcrypt hash)
// demo χρήστη στο repo. Το seed παίρνει τον κωδικό ΜΟΝΟ από το env.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("SETUP.md / seed.ts / 02-seed.sql: κανένας κωδικός ή hash demo χρήστη", () => {
  for (const f of ["SETUP.md", "prisma/seed.ts", "prisma/sql/02-seed.sql", ".env.example"]) {
    const s = read(f);
    assert.doesNotMatch(s, /\$2[aby]\$\d{2}\$/, `${f}: bcrypt hash`);
    assert.doesNotMatch(s, /bcrypt\.hash\(\s*["'`]/, `${f}: σταθερός κωδικός σε bcrypt.hash`);
    assert.doesNotMatch(s, /@prentals\.gr\s*\/\s*\S+/, `${f}: «email / κωδικός»`);
  }
});

test("seed: demo χρήστες μόνο με DEMO_PASSWORD (≥ 12), αλλιώς παραλείπονται· κανένας κωδικός δεν τυπώνεται", () => {
  const seed = read("prisma/seed.ts");
  assert.match(seed, /process\.env\.DEMO_PASSWORD/);
  assert.match(seed, /rawDemo\.length >= 12 \? rawDemo : null/);
  assert.match(seed, /if \(demoPassword\) \{/);
  assert.equal((seed.match(/bcrypt\.hash\(demoPassword, 12\)/g) ?? []).length, 3);
  assert.doesNotMatch(seed, /console\.log\([^)]*\$\{(superAdminPassword|demoPassword|rawDemo)\}/);
  // Το SQL seed δεν δημιουργεί πια χρήστες.
  assert.doesNotMatch(read("prisma/sql/02-seed.sql"), /INSERT INTO "users"/);
  assert.match(read(".env.example"), /^DEMO_PASSWORD=""$/m);
});
