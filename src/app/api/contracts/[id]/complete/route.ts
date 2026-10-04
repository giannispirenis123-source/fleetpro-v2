export const dynamic = "force-dynamic";
// src/app/api/contracts/[id]/complete/route.ts
// Ολοκλήρωση: μόνο υπογεγραμμένο συμβόλαιο με καταγεγραμμένο καύσιμο
// παράδοσης. Μετά δεν αλλάζει τίποτα. Η κράτηση ακολουθεί (→ COMPLETED,
// μόνο προς τα εμπρός) και ενεργοποιεί το αυτόματο τιμολόγιο, αν ισχύει.

import { db } from "@/lib/db";
import { ok, badRequest, conflict, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import {
  advanceBookingWithContract,
  issueInvoiceOnCompletion,
  syncVehicleStatus,
} from "@/lib/bookingLifecycle";
import { CONTRACT_INCLUDE, contractScope, refreshSearchText, toContractDTO } from "@/lib/contractForm";

// POST /api/contracts/[id]/complete
export const POST = withPermission(
  async (_req, _session, params, viewer) => {
    try {
      const current = await db.contract.findFirst({
        where: { ...contractScope(viewer!), id: params!.id },
        select: { id: true, status: true, fuelReturn: true, bookingId: true },
      });
      if (!current) return notFound("Το συμβόλαιο δεν βρέθηκε");
      if (current.status !== "SIGNED") {
        return conflict("Ολοκληρώνεται μόνο υπογεγραμμένο συμβόλαιο");
      }
      if (current.fuelReturn === null) {
        return badRequest("Κατέγραψε πρώτα το καύσιμο στην παράδοση");
      }

      const tenantId = viewer!.tenantId!;
      const STALE = "STALE";
      let moved: Awaited<ReturnType<typeof advanceBookingWithContract>> = null;
      try {
        moved = await db.$transaction(async (tx) => {
          const result = await tx.contract.updateMany({
            where: { id: current.id, status: "SIGNED" },
            data: { status: "COMPLETED", completedAt: new Date() },
          });
          if (result.count === 0) throw new Error(STALE);
          return advanceBookingWithContract(tx, tenantId, current.bookingId, "COMPLETED");
        });
      } catch (error) {
        if (error instanceof Error && error.message === STALE) {
          return conflict("Το συμβόλαιο άλλαξε στο μεταξύ");
        }
        throw error;
      }

      await refreshSearchText(current.id);

      // Ίδια συνέχεια με το PATCH κράτησης: ελευθέρωση οχήματος και
      // τιμολόγιο ON_COMPLETION (ιδεμποτικό· αποτυχία δεν γυρίζει πίσω).
      if (moved) {
        await syncVehicleStatus(moved.vehicleId, tenantId);
        if (moved.to === "COMPLETED") await issueInvoiceOnCompletion(tenantId, current.bookingId);
      }

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
