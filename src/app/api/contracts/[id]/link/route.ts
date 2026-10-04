export const dynamic = "force-dynamic";
// src/app/api/contracts/[id]/link/route.ts
// Link πελάτη (/c/[token]): ακύρωση ή νέο link (contracts.edit).
//
// POST { action: "revoke" } → το link παύει να ισχύει αμέσως.
// POST { action: "renew" }  → νέο token· το παλιό παύει να ισχύει αμέσως.
// Μόνο για υπογεγραμμένο/ολοκληρωμένο συμβόλαιο. Δεν αλλάζει το "updatedAt"
// (δεν είναι στοιχείο του εγγράφου — η ανοιχτή φόρμα δεν πρέπει να «χαλάσει»).
// Κανένα δεδομένο συμβολαίου δεν επιστρέφεται με βάση το token.

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, badRequest, conflict, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { contractScope } from "@/lib/contractForm";
import { newPublicToken, publicLinkDTO } from "@/lib/contractLink";

const schema = z.object({ action: z.enum(["revoke", "renew"]) });

// POST /api/contracts/[id]/link
export const POST = withPermission(
  async (req, _session, params, viewer) => {
    try {
      const parsed = schema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα");

      const c = await db.contract.findFirst({
        where: { ...contractScope(viewer!), id: params!.id },
        select: { id: true, status: true, publicToken: true, booking: { select: { returnDate: true } } },
      });
      if (!c) return notFound("Το συμβόλαιο δεν βρέθηκε");
      if (c.status === "DRAFT") {
        return conflict("Το link πελάτη υπάρχει μόνο αφού υπογράψουν όλοι");
      }

      const revoke = parsed.data.action === "revoke";
      if (revoke && !c.publicToken) return conflict("Δεν υπάρχει link");
      const token = revoke ? c.publicToken : newPublicToken();
      const revokedAt = revoke ? new Date() : null;

      // Raw SQL: χωρίς αλλαγή του "updatedAt" (αισιόδοξο κλείδωμα της φόρμας).
      await db.$executeRaw(Prisma.sql`
        UPDATE "contracts"
        SET "publicToken" = ${token}, "publicTokenRevokedAt" = ${revokedAt}
        WHERE "id" = ${c.id}
      `);

      return ok({
        publicLink: publicLinkDTO({
          publicToken: token,
          publicTokenRevokedAt: revokedAt,
          returnDate: c.booking.returnDate.toISOString().slice(0, 10),
        }),
      });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "contracts.edit"
);
