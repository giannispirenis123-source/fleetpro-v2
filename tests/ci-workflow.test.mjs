// tests/ci-workflow.test.mjs — το CI τρέχει σε κάθε PR όλους τους ελέγχους,
// χωρίς secrets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const yml = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

test("CI: σε κάθε pull request, με install → prisma generate → typecheck → lint → test → build", () => {
  assert.match(yml, /^on:\n  pull_request:/m);
  const steps = ["npm ci", "npx prisma generate", "npx tsc --noEmit -p .", "npm run lint", "npm test", "npm run build"];
  let at = -1;
  for (const s of steps) {
    const i = yml.indexOf(`run: ${s}`);
    assert.ok(i > at, `βήμα «${s}» με τη σωστή σειρά`);
    at = i;
  }
});

test("CI: κανένα secret, μόνο ανάγνωση του repo", () => {
  assert.doesNotMatch(yml, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(yml, /pull_request_target/);
  assert.match(yml, /^permissions:\n  contents: read$/m);
});
