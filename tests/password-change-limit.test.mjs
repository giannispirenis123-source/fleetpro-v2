// tests/password-change-limit.test.mjs — όριο προσπαθειών στην αλλαγή του
// δικού μας κωδικού (έλεγχος «τρέχων κωδικός»).

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

const { hitLimit, LIMITS } = await import("../src/lib/public/rateLimit.ts");
const src = readFileSync(new URL("../src/app/api/users/me/password/route.ts", import.meta.url), "utf8");

test("5 προσπάθειες / 15΄ ανά χρήστη· η 6η απορρίπτεται· άλλος χρήστης δεν επηρεάζεται· νέο παράθυρο ξαναρχίζει", async () => {
  const counts = new Map();
  const store = { increment: async (k, w) => { const key = `${k}|${w.toISOString()}`; counts.set(key, (counts.get(key) ?? 0) + 1); return counts.get(key); } };
  const L = LIMITS.passwordChangePerUser;
  assert.deepEqual({ max: L.max, windowMinutes: L.windowMinutes }, { max: 5, windowMinutes: 15 });
  const now = new Date("2026-11-14T10:00:00Z");
  for (let i = 0; i < 5; i++) assert.equal(await hitLimit(store, L, "user-1", now), true);
  assert.equal(await hitLimit(store, L, "user-1", now), false);
  assert.equal(await hitLimit(store, L, "user-2", now), true);
  assert.equal(await hitLimit(store, L, "user-1", new Date("2026-11-14T10:15:00Z")), true);
});

test("route: το όριο μετρά ΠΡΙΝ τον έλεγχο του κωδικού, με το id του session, και απαντά 429", () => {
  assert.match(src, /hitLimit\(dbCounterStore, LIMITS\.passwordChangePerUser, session\.userId\)/);
  assert.match(src, /status: 429/);
  assert.ok(src.indexOf("LIMITS.passwordChangePerUser") < src.indexOf("bcrypt.compare(currentPassword"));
  assert.ok(src.indexOf("LIMITS.passwordChangePerUser") < src.indexOf("db.user.findUnique"));
});
