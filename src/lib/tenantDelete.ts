// src/lib/tenantDelete.ts
// Οριστική διαγραφή εταιρίας (Super Admin) — ΜΟΝΟ server. Κανόνες και λίστα
// πινάκων: tenantDeleteCore.ts.
//
// · ΜΙΑ transaction: όλα τα δεδομένα της εταιρίας και οι χρήστες της (τα
//   emails ελευθερώνονται). Κάθε DELETE έχει WHERE "tenantId" = <αυτή η
//   εταιρία> — καμία άλλη εταιρία δεν ακουμπιέται.
// · Ζωντανή συνδρομή Stripe → 409 «Ακύρωσε πρώτα…». Το Stripe ΔΕΝ καλείται.
// · Μετά το commit: φωτογραφίες Cloudinary fleetpro/<id>/ best effort με
//   όριο χρόνου· αποτυχία = μόνο κωδικός στα logs.
// · Log: μόνο id, όνομα εταιρίας, ημερομηνία.

import { Prisma } from "@prisma/client";
import { db } from "./db";
import { cloudinaryConfig, destroyCompanyFolder } from "./cloudinary";
import { withTimeout } from "./withTimeout";
import { FOUNDING_PROGRAM_ID } from "./billing/founding";
import {
  NAME_MISMATCH,
  TENANT_TABLES,
  deleteBlockReason,
  nameConfirmed,
  type TenantDeleteSummary,
} from "./tenantDeleteCore";

export class TenantDeleteError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TenantDeleteError";
    this.status = status;
  }
}

export async function tenantDeleteSummary(id: string): Promise<TenantDeleteSummary | null> {
  const t = await db.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      billingStatus: true,
      stripeSubId: true,
      stripeAccountId: true,
      founderClaim: { select: { slotNumber: true } },
      _count: { select: { users: true, vehicles: true, bookings: true, contracts: true, invoices: true, customers: true } },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    counts: t._count,
    blocked: deleteBlockReason(t),
    stripeConnect: Boolean(t.stripeAccountId),
    founderSlot: t.founderClaim?.slotNumber ?? null,
  };
}

const CLOUDINARY_TIMEOUT_MS = 15_000;

export async function deleteTenant(
  id: string,
  input: { confirmName: unknown; releaseFounderSlot?: boolean },
  now = new Date()
): Promise<{ id: string; name: string; releasedSlot: number | null }> {
  const result = await db.$transaction(
    async (tx) => {
      // Κλείδωμα της εταιρίας: τίποτα δεν αλλάζει την κατάσταση ενώ σβήνεται.
      const rows = await tx.$queryRaw<{ id: string; name: string; billingStatus: string; stripeSubId: string | null }[]>`
        SELECT "id", "name", "billingStatus", "stripeSubId" FROM "tenants" WHERE "id" = ${id} FOR UPDATE`;
      const t = rows[0];
      if (!t) throw new TenantDeleteError(404, "Η εταιρία δεν βρέθηκε");
      if (!nameConfirmed(input.confirmName, t.name)) throw new TenantDeleteError(400, NAME_MISMATCH);
      const blocked = deleteBlockReason(t);
      if (blocked) throw new TenantDeleteError(409, blocked);

      // Θέση ιδρυτή: προεπιλογή ΜΕΝΕΙ πιασμένη (tenantId → NULL από το FK).
      let releasedSlot: number | null = null;
      if (input.releaseFounderSlot) {
        const claim = await tx.$queryRaw<{ slotNumber: number }[]>`
          DELETE FROM "founder_claims" WHERE "tenantId" = ${id} RETURNING "slotNumber"`;
        if (claim.length === 1) {
          releasedSlot = Number(claim[0].slotNumber);
          await tx.$executeRaw`
            UPDATE "founding_program"
               SET "claimedCount" = GREATEST("claimedCount" - 1, 0), "updatedAt" = ${now}
             WHERE "id" = ${FOUNDING_PROGRAM_ID}`;
        }
      }

      for (const table of TENANT_TABLES) {
        // Όνομα πίνακα ΜΟΝΟ από τη σταθερή λίστα· η τιμή πάντα παράμετρος.
        await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw(`"${table}"`)} WHERE "tenantId" = ${id}`);
      }
      await tx.$executeRaw`DELETE FROM "tenants" WHERE "id" = ${id}`;
      return { id: t.id, name: t.name, releasedSlot };
    },
    { timeout: 60_000, maxWait: 10_000 }
  );

  console.info(`[FleetPro] Διαγραφή εταιρίας: id=${result.id} name=${JSON.stringify(result.name)} at=${now.toISOString()}`);

  // Φωτογραφίες Cloudinary: best effort ΜΕΤΑ το commit.
  const cfg = cloudinaryConfig();
  if (cfg.ok) {
    const code = await withTimeout(destroyCompanyFolder(cfg.config, result.id), CLOUDINARY_TIMEOUT_MS, "cloudinary").catch(
      (e: unknown) => (e instanceof Error ? e.name : "error")
    );
    if (code) console.error(`[FleetPro] Διαγραφή εταιρίας ${result.id}: Cloudinary ${code}`);
  }
  return result;
}
