// tests/e2e/founding-concurrency.db.ts
// Ταυτόχρονες διεκδικήσεις θέσης ιδρυτή με ΠΡΑΓΜΑΤΙΚΗ PostgreSQL — ο ΙΔΙΟΣ
// κώδικας με την εγγραφή (claimFounderSlot μέσα σε $transaction).
//
// ΜΟΝΟ τοπικά, σε ΔΟΚΙΜΑΣΤΙΚΗ βάση (γράφει και σβήνει εταιρίες/κωδικούς με
// πρόθεμα "fctest-"). Ποτέ στη βάση παραγωγής.
//   DATABASE_URL=postgresql://…/fleetpro_test npx tsx --test tests/e2e/founding-concurrency.db.ts
//
// Σενάρια:
//   1. 9 θέσεις πιασμένες, 25 ταυτόχρονες εγγραφές για τη 10η → ΜΟΝΟ 1 επιτυχία,
//      μετρητής = 10, ακριβώς 10 διεκδικήσεις (θέσεις 1–10), οι υπόλοιπες «closed».
//   2. Κωδικός μίας χρήσης, 10 ταυτόχρονες → 1 επιτυχία, οι άλλες «invalid».
//   3. Rollback: αποτυχία μετά τη διεκδίκηση → ούτε θέση ούτε εταιρία.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { claimFounderSlot } from "../../src/lib/billing/foundingServer";
import { FounderClaimError, hashFounderCode } from "../../src/lib/billing/founding";

const db = new PrismaClient();
const PREFIX = "fctest-";

async function cleanup() {
  await db.founderClaim.deleteMany({ where: { code: { label: { startsWith: PREFIX } } } });
  await db.founderCode.deleteMany({ where: { label: { startsWith: PREFIX } } });
  await db.tenant.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await db.foundingProgram.update({ where: { id: "founding" }, data: { claimedCount: await db.founderClaim.count(), active: true } });
}

async function newCode(code: string, maxClaims: number) {
  await db.founderCode.create({ data: { codeHash: hashFounderCode(code), label: `${PREFIX}${code}`, maxClaims } });
}

/** Μία «εγγραφή»: εταιρία + διεκδίκηση στην ίδια transaction (όπως στο signupServer). */
async function signup(i: number, code: string): Promise<"ok" | "closed" | "invalid"> {
  try {
    await db.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: { name: `FC ${i}`, slug: `${PREFIX}${code.toLowerCase()}-${i}`, email: `${PREFIX}${code.toLowerCase()}-${i}@example.test`, billingStatus: "founder_trial" },
      });
      await claimFounderSlot(tx, code, t.id);
    });
    return "ok";
  } catch (e) {
    if (e instanceof FounderClaimError) return e.state;
    throw e;
  }
}

before(async () => {
  const existing = await db.founderClaim.count({ where: { NOT: { code: { label: { startsWith: PREFIX } } } } });
  assert.equal(existing, 0, "η βάση έχει ήδη πραγματικές διεκδικήσεις — τρέξε σε δοκιμαστική βάση");
  await cleanup();
});
after(async () => {
  await cleanup();
  await db.$disconnect();
});

test("25 ταυτόχρονες εγγραφές για τη 10η θέση → ΜΟΝΟ 1 επιτυχία, ποτέ πάνω από 10", async () => {
  await newCode("FCMULTI01", 10);
  for (let i = 1; i <= 9; i++) assert.equal(await signup(i, "FCMULTI01"), "ok");
  await newCode("FCLAST001", 10);
  const results = await Promise.all(Array.from({ length: 25 }, (_, k) => signup(100 + k, "FCLAST001")));
  assert.equal(results.filter((r) => r === "ok").length, 1, JSON.stringify(results));
  assert.equal(results.filter((r) => r === "closed").length, 24);
  const program = await db.foundingProgram.findUniqueOrThrow({ where: { id: "founding" } });
  assert.equal(program.claimedCount, 10);
  const slots = (await db.founderClaim.findMany({ select: { slotNumber: true }, orderBy: { slotNumber: "asc" } })).map((c) => c.slotNumber);
  assert.deepEqual(slots, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // Οι αποτυχημένες δεν άφησαν εταιρίες πίσω τους (rollback).
  assert.equal(await db.tenant.count({ where: { slug: { startsWith: `${PREFIX}fclast001-` } } }), 1);
  // 11η: κλειστό.
  assert.equal(await signup(200, "FCLAST001"), "closed");
});

test("κωδικός μίας χρήσης, 10 ταυτόχρονες → 1 επιτυχία, οι άλλες «invalid»", async () => {
  await cleanup();
  await newCode("FCSINGLE1", 1);
  const results = await Promise.all(Array.from({ length: 10 }, (_, k) => signup(300 + k, "FCSINGLE1")));
  assert.equal(results.filter((r) => r === "ok").length, 1, JSON.stringify(results));
  assert.equal(results.filter((r) => r === "invalid").length, 9);
  const program = await db.foundingProgram.findUniqueOrThrow({ where: { id: "founding" } });
  assert.equal(program.claimedCount, 1, "οι αποτυχημένες δεν κράτησαν θέση");
});

test("λάθος/ληγμένος κωδικός → invalid, καμία θέση, καμία εταιρία", async () => {
  await cleanup();
  await db.founderCode.create({
    data: { codeHash: hashFounderCode("FCEXPIRED"), label: `${PREFIX}FCEXPIRED`, expiresAt: new Date(Date.now() - 1000) },
  });
  assert.equal(await signup(400, "FCEXPIRED"), "invalid");
  assert.equal(await signup(401, "FCNOPE999"), "invalid");
  const program = await db.foundingProgram.findUniqueOrThrow({ where: { id: "founding" } });
  assert.equal(program.claimedCount, 0);
  assert.equal(await db.tenant.count({ where: { slug: { startsWith: `${PREFIX}fcexpired-` } } }), 0);
});

test("η βάση μόνη της δεν αφήνει πάνω από 10 (CHECK) ούτε διπλή θέση (UNIQUE)", async () => {
  await assert.rejects(db.$executeRaw`UPDATE "founding_program" SET "claimedCount" = 11 WHERE "id" = 'founding'`);
  await assert.rejects(db.$executeRaw`UPDATE "founding_program" SET "maxSlots" = 11 WHERE "id" = 'founding'`);
  await newCode("FCDUPSLOT", 2);
  const code = await db.founderCode.findUniqueOrThrow({ where: { codeHash: hashFounderCode("FCDUPSLOT") } });
  await db.founderClaim.create({ data: { codeId: code.id, slotNumber: 5 } });
  await assert.rejects(db.founderClaim.create({ data: { codeId: code.id, slotNumber: 5 } }));
  await assert.rejects(db.founderClaim.create({ data: { codeId: code.id, slotNumber: 11 } }));
});
