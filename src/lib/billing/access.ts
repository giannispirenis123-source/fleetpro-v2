// src/lib/billing/access.ts
// Πρόσβαση με βάση τη συνδρομή — ΜΟΝΟ server. Η απόφαση: core.ts (billingAccess).

import { db } from "../db";
import { billingAccess, type BillingAccess } from "./core";

export const BILLING_STATE_SELECT = { billingStatus: true, trialEndsAt: true, pastDueSince: true } as const;

export async function tenantBillingAccess(tenantId: string, now = new Date()): Promise<BillingAccess> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: BILLING_STATE_SELECT });
  return t ? billingAccess(t, now) : { mode: "full" };
}

export async function tenantReadOnly(tenantId: string, now = new Date()): Promise<boolean> {
  return (await tenantBillingAccess(tenantId, now)).mode === "read_only";
}
