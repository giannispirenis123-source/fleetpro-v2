// src/lib/billing/foundingAdmin.ts
// Super Admin: πρόγραμμα ιδρυτών (κωδικοί, θέσεις, ειδοποιήσεις) — ΜΟΝΟ server.

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { FOUNDING_PROGRAM_ID, generateFounderCode, hashFounderCode, remainingSpots } from "./founding";
import { billingNow, founderNoticeDue, founderNoticeEmail, isBillingInterval, testClocksEnabled } from "./core";

export const createCodeSchema = z.object({
  label: z.string().trim().max(120).optional(),
  maxClaims: z.number().int().min(1).max(10).default(1),
  /** "YYYY-MM-DD" (τέλος της ημέρας, ώρα Ελλάδας ≈ 21:00 UTC) ή κενό = χωρίς λήξη. */
  expiresOn: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()]).optional(),
});

export const updateFoundingSchema = z.object({
  codeId: z.string().min(1).max(64).optional(),
  codeActive: z.boolean().optional(),
  programActive: z.boolean().optional(),
});

export async function foundingAdminView(now = new Date()) {
  const [program, codes, claims, noticeTenants] = await Promise.all([
    db.foundingProgram.findUnique({ where: { id: FOUNDING_PROGRAM_ID } }),
    db.founderCode.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, maxClaims: true, claimedCount: true, active: true, expiresAt: true, createdAt: true },
    }),
    db.founderClaim.findMany({
      orderBy: { slotNumber: "asc" },
      select: { slotNumber: true, claimedAt: true, code: { select: { label: true } }, tenant: { select: { id: true, name: true } } },
    }),
    db.tenant.findMany({
      where: { founderDiscountEndsAt: { not: null }, founderNoticeSentAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        billingStatus: true,
        billingInterval: true,
        founderDiscountEndsAt: true,
        founderNoticeSentAt: true,
        stripeTestClockId: true,
        billingClockAt: true,
        entitlementPlan: { select: { name: true, priceMonthlyCents: true, priceYearlyCents: true } },
      },
    }),
  ]);
  // Ειδοποιήσεις «η έκπτωση τελειώνει σε 30 ημέρες»: ΜΟΝΟ λογική + κείμενο.
  // Η αποστολή σε πελάτες θέλει επαληθευμένο domain στο Resend (δεν υπάρχει ακόμα).
  const notices = noticeTenants
    .filter((t) => founderNoticeDue(t, billingNow(t, now, testClocksEnabled(process.env))))
    .map((t) => {
      const interval = isBillingInterval(t.billingInterval) ? t.billingInterval : "month";
      const cents = (interval === "year" ? t.entitlementPlan?.priceYearlyCents : t.entitlementPlan?.priceMonthlyCents) ?? 0;
      const mail = founderNoticeEmail("el", t.email, t.name, t.entitlementPlan?.name ?? "", t.founderDiscountEndsAt!, cents, interval);
      return {
        tenantId: t.id,
        tenantName: t.name,
        endsAt: t.founderDiscountEndsAt!.toISOString(),
        subject: mail.subject,
        text: mail.text,
        // Έλεγχος ποσών (#45): αποτυχία → το κείμενο δεν πρέπει να σταλεί. Μόνο ο κωδικός.
        amountBlocked: mail.amountCheck.ok ? null : mail.amountCheck.code,
      };
    });
  return {
    program: program
      ? { maxSlots: program.maxSlots, claimed: program.claimedCount, remaining: remainingSpots(program), active: program.active }
      : null,
    codes: codes.map((c) => ({ ...c, expiresAt: c.expiresAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString() })),
    claims: claims.map((c) => ({
      slot: c.slotNumber,
      claimedAt: c.claimedAt.toISOString(),
      codeLabel: c.code.label,
      tenantId: c.tenant?.id ?? null,
      tenantName: c.tenant?.name ?? null,
    })),
    notices,
  };
}

/** Νέος κωδικός: επιστρέφεται ΜΙΑ φορά· στη βάση μόνο το hash. */
export async function createFounderCode(input: z.infer<typeof createCodeSchema>): Promise<{ id: string; code: string }> {
  const expiresAt = input.expiresOn ? new Date(`${input.expiresOn}T21:00:00.000Z`) : null;
  for (let i = 0; i < 5; i++) {
    const code = generateFounderCode();
    try {
      const row = await db.founderCode.create({
        data: { codeHash: hashFounderCode(code), label: input.label || null, maxClaims: input.maxClaims, expiresAt },
        select: { id: true },
      });
      return { id: row.id, code };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("founder code: collisions");
}
