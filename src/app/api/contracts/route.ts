export const dynamic = "force-dynamic";
// src/app/api/contracts/route.ts
// Λίστα συμβολαίων και «άνοιγμα» συμβολαίου από κράτηση.
// Tenant-scoped· ο συνεργάτης βλέπει μόνο τα δικά του (contractScope).

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, created, badRequest, forbidden, notFound, conflict, serverError } from "@/lib/api";
import { bookingScope, viewerCan, withPermission } from "@/lib/authz";
import { contractScope, createContract, loadContractList } from "@/lib/contractForm";

// GET /api/contracts?status=&q=
export const GET = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      const sp = new URL(req.url).searchParams;
      const contracts = await loadContractList(viewer!, {
        status: sp.get("status"),
        q: sp.get("q"),
      });
      return ok({ contracts });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "contracts.view"
);

const openSchema = z.object({ bookingId: z.string().min(1) });

// POST /api/contracts { bookingId } — επιστρέφει το υπάρχον ή φτιάχνει νέο.
export const POST = withPermission(
  async (req, session, _params, viewer) => {
    try {
      const parsed = openSchema.safeParse(await req.json());
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);

      const booking = await db.booking.findFirst({
        where: { ...bookingScope(viewer!), id: parsed.data.bookingId },
        select: {
          id: true,
          status: true,
          customerId: true,
          pickupLocation: true,
          returnLocation: true,
          deposit: true,
        },
      });
      if (!booking) return notFound("Η κράτηση δεν βρέθηκε");

      const existing = await db.contract.findFirst({
        where: { ...contractScope(viewer!), bookingId: booking.id },
        select: { id: true },
      });
      if (existing) return ok({ id: existing.id, created: false });

      if (!viewerCan(viewer!, "contracts.create")) {
        return forbidden("Δεν έχετε δικαίωμα δημιουργίας συμβολαίου");
      }
      if (booking.status === "CANCELLED") {
        return badRequest("Ακυρωμένη κράτηση δεν παίρνει συμβόλαιο");
      }

      try {
        const contract = await createContract(viewer!, session.name, booking);
        return created({ id: contract.id, created: true });
      } catch (error) {
        // Ταυτόχρονο άνοιγμα από δύο χρήστες: κρατάμε αυτό που πρόλαβε.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const again = await db.contract.findFirst({
            where: { ...contractScope(viewer!), bookingId: booking.id },
            select: { id: true },
          });
          if (again) return ok({ id: again.id, created: false });
          return conflict("Υπάρχει ήδη συμβόλαιο για αυτή την κράτηση");
        }
        throw error;
      }
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "contracts.view"
);
