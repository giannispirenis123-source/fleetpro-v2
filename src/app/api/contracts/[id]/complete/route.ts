export const dynamic = "force-dynamic";
// src/app/api/contracts/[id]/complete/route.ts
// Ολοκλήρωση: μόνο υπογεγραμμένο συμβόλαιο με καταγεγραμμένο καύσιμο
// παράδοσης. Μετά δεν αλλάζει τίποτα.

import { db } from "@/lib/db";
import { ok, badRequest, conflict, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { CONTRACT_INCLUDE, contractScope, toContractDTO } from "@/lib/contractForm";

// POST /api/contracts/[id]/complete
export const POST = withPermission(
  async (_req, _session, params, viewer) => {
    try {
      const current = await db.contract.findFirst({
        where: { ...contractScope(viewer!), id: params!.id },
        select: { id: true, status: true, fuelReturn: true },
      });
      if (!current) return notFound("Το συμβόλαιο δεν βρέθηκε");
      if (current.status !== "SIGNED") {
        return conflict("Ολοκληρώνεται μόνο υπογεγραμμένο συμβόλαιο");
      }
      if (current.fuelReturn === null) {
        return badRequest("Κατέγραψε πρώτα το καύσιμο στην παράδοση");
      }

      const result = await db.contract.updateMany({
        where: { id: current.id, status: "SIGNED" },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      if (result.count === 0) return conflict("Το συμβόλαιο άλλαξε στο μεταξύ");

      const fresh = await db.contract.findUniqueOrThrow({
        where: { id: current.id },
        include: CONTRACT_INCLUDE,
      });
      return ok({ contract: toContractDTO(fresh) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "contracts.edit"
);
