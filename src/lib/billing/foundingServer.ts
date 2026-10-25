// src/lib/billing/foundingServer.ts
// Πρόγραμμα «Πρώτες 10 εταιρίες» με τη βάση — ΜΟΝΟ server.
//
// Η διεκδίκηση θέσης τρέχει ΜΕΣΑ στη transaction της εγγραφής:
//   1. founding_program.claimedCount + 1 ΜΟΝΟ αν < maxSlots (ατομικό UPDATE,
//      κλειδώνει τη γραμμή: οι ταυτόχρονες εγγραφές περιμένουν σειρά και
//      ξαναδιαβάζουν τον μετρητή) → ο νέος αριθμός είναι ο αριθμός θέσης.
//   2. founder_codes.claimedCount + 1 ΜΟΝΟ αν ο κωδικός ισχύει.
//   3. founder_claims με slotNumber UNIQUE + CHECK 1–10 (δεύτερο δίχτυ).
// Οτιδήποτε αποτύχει → FounderClaimError → rollback ΟΛΗΣ της εγγραφής.

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import {
  FOUNDING_PROGRAM_ID,
  FounderClaimError,
  founderCodeState,
  hashFounderCode,
  remainingSpots,
  type FounderCodeState,
} from "./founding";

export async function foundingRemaining(client: Pick<typeof db, "foundingProgram"> = db): Promise<number> {
  const p = await client.foundingProgram.findUnique({
    where: { id: FOUNDING_PROGRAM_ID },
    select: { maxSlots: true, claimedCount: true, active: true },
  });
  return remainingSpots(p);
}

/** Έλεγχος ΠΡΙΝ τη transaction (γρήγορο, μόνο ανάγνωση). Η αυθεντική απόφαση: claimFounderSlot. */
export async function precheckFounderCode(raw: string, now = new Date()): Promise<FounderCodeState> {
  const [remaining, code] = await Promise.all([
    foundingRemaining(),
    db.founderCode.findUnique({
      where: { codeHash: hashFounderCode(raw) },
      select: { active: true, maxClaims: true, claimedCount: true, expiresAt: true },
    }),
  ]);
  return founderCodeState(code, remaining, now);
}

/** Η ατομική διεκδίκηση — μέσα σε transaction. Επιστρέφει τον αριθμό θέσης (1–10). */
export async function claimFounderSlot(
  tx: Prisma.TransactionClient,
  raw: string,
  tenantId: string,
  now = new Date()
): Promise<number> {
  const slot = await tx.$queryRaw<{ claimedCount: number }[]>`
    UPDATE "founding_program"
       SET "claimedCount" = "claimedCount" + 1, "updatedAt" = ${now}
     WHERE "id" = ${FOUNDING_PROGRAM_ID} AND "active" AND "claimedCount" < "maxSlots"
    RETURNING "claimedCount"`;
  if (slot.length !== 1) throw new FounderClaimError("closed");

  const code = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "founder_codes"
       SET "claimedCount" = "claimedCount" + 1
     WHERE "codeHash" = ${hashFounderCode(raw)} AND "active" AND "claimedCount" < "maxClaims"
       AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
    RETURNING "id"`;
  if (code.length !== 1) throw new FounderClaimError("invalid");

  // Η μικρότερη ΕΛΕΥΘΕΡΗ θέση (1–10). Συνήθως = μετρητής· διαφέρει μόνο αν
  // μια θέση απελευθερώθηκε σε διαγραφή εταιρίας. Ασφαλές: η γραμμή του
  // προγράμματος είναι κλειδωμένη από το UPDATE ως το τέλος της transaction.
  const free = await tx.$queryRaw<{ n: number }[]>`
    SELECT min(n)::int AS n FROM generate_series(1, 10) AS n
     WHERE n NOT IN (SELECT "slotNumber" FROM "founder_claims")`;
  if (free[0]?.n == null) throw new FounderClaimError("closed");
  const slotNumber = Number(free[0].n);
  await tx.$executeRaw`
    INSERT INTO "founder_claims" ("id", "codeId", "tenantId", "slotNumber", "claimedAt")
    VALUES (${randomUUID()}, ${code[0].id}, ${tenantId}, ${slotNumber}, ${now})`;
  return slotNumber;
}
