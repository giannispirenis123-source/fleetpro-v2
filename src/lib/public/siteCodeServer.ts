// src/lib/public/siteCodeServer.ts
// Εκπτωτικός κωδικός του site — ΜΟΝΟ server: ανάγνωση (μόνο της εταιρίας του
// site) και ΑΤΟΜΙΚΗ δέσμευση χρήσης μέσα στην transaction της κράτησης.

import { Prisma } from "@prisma/client";
import type { SiteCodeRecord } from "./siteCode";

type Client = Pick<Prisma.TransactionClient, "discount" | "$executeRaw">;

/** Ο κωδικός της ΕΤΑΙΡΙΑΣ `tenantId` (ποτέ άλλης) με τον δημιουργό του, ή null. */
export async function loadSiteCode(client: Pick<Prisma.TransactionClient, "discount">, tenantId: string, code: string): Promise<SiteCodeRecord | null> {
  const d = await client.discount.findFirst({
    where: { tenantId, code },
    select: {
      id: true,
      tenantId: true,
      code: true,
      type: true,
      value: true,
      target: true,
      minDays: true,
      minAmount: true,
      maxDiscount: true,
      validFrom: true,
      validUntil: true,
      usageLimit: true,
      usageCount: true,
      isActive: true,
      createdBy: {
        select: {
          id: true,
          role: true,
          tenantId: true,
          isActive: true,
          commissionRate: true,
          commissionOnRental: true,
          commissionOnExtras: true,
          commissionOnInsurance: true,
        },
      },
    },
  });
  if (!d || !d.code) return null;
  const c = d.createdBy;
  return {
    id: d.id,
    tenantId: d.tenantId,
    code: d.code,
    type: d.type,
    value: Number(d.value),
    target: d.target,
    minDays: d.minDays,
    minAmount: d.minAmount === null ? null : Number(d.minAmount),
    maxDiscount: d.maxDiscount === null ? null : Number(d.maxDiscount),
    validFrom: d.validFrom,
    validUntil: d.validUntil,
    usageLimit: d.usageLimit,
    usageCount: d.usageCount,
    isActive: d.isActive,
    creator: c
      ? {
          id: c.id,
          role: c.role,
          tenantId: c.tenantId,
          isActive: c.isActive,
          commissionRate: Number(c.commissionRate),
          commissionOnRental: c.commissionOnRental,
          commissionOnExtras: c.commissionOnExtras,
          commissionOnInsurance: c.commissionOnInsurance,
        }
      : null,
  };
}

/**
 * +1 χρήση ΜΟΝΟ αν υπάρχει ακόμα διαθέσιμη (ένα UPDATE με τη συνθήκη μέσα:
 * δύο ταυτόχρονες κρατήσεις με κωδικό μίας χρήσης → η μία περνά, η άλλη όχι).
 * true = δεσμεύτηκε.
 */
export async function claimSiteCodeUse(client: Client, tenantId: string, discountId: string): Promise<boolean> {
  const n = await client.$executeRaw`
    UPDATE "discounts"
    SET "usageCount" = "usageCount" + 1, "updatedAt" = now()
    WHERE "id" = ${discountId} AND "tenantId" = ${tenantId} AND "isActive" = true
      AND ("usageLimit" IS NULL OR "usageCount" < "usageLimit")`;
  return n === 1;
}
