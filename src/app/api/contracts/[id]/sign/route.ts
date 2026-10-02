export const dynamic = "force-dynamic";
// src/app/api/contracts/[id]/sign/route.ts
// Υπογραφή ενός οδηγού (ή σβήσιμό της, όσο το συμβόλαιο είναι πρόχειρο).
//
// Πριν την πρώτη υπογραφή: υποχρεωτική συγκατάθεση GDPR και όνομα σε ΚΑΘΕ
// οδηγό· το snapshot παίρνεται ξανά και παγώνει. Με την τελευταία
// υπογραφή το συμβόλαιο γίνεται SIGNED και τα στοιχεία παραλαβής κλειδώνουν.

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, badRequest, conflict, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { advanceBookingWithContract, syncVehicleStatus } from "@/lib/bookingLifecycle";
import { allSigned, anySigned, readDrivers } from "@/lib/contracts";
import {
  CONTRACT_INCLUDE,
  refreshSearchText,
  buildSnapshot,
  contractScope,
  requestIp,
  signSchema,
  toContractDTO,
} from "@/lib/contractForm";

// POST /api/contracts/[id]/sign { driverId, signature | null }
export const POST = withPermission(
  async (req, _session, params, viewer) => {
    try {
      const current = await db.contract.findFirst({
        where: { ...contractScope(viewer!), id: params!.id },
      });
      if (!current) return notFound("Το συμβόλαιο δεν βρέθηκε");
      if (current.status !== "DRAFT") {
        return conflict("Το συμβόλαιο έχει ήδη υπογραφεί από όλους");
      }

      const parsed = signSchema.safeParse(await req.json());
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      const { driverId, signature } = parsed.data;

      const drivers = readDrivers(current.drivers);
      const index = drivers.findIndex((d) => d.id === driverId);
      if (index < 0) return notFound("Ο οδηγός δεν βρέθηκε — αποθήκευσε πρώτα το συμβόλαιο");

      const data: Prisma.ContractUpdateManyMutationInput = {};

      if (signature) {
        if (!current.gdprConsent) {
          return badRequest("Χρειάζεται η συγκατάθεση GDPR πριν την υπογραφή");
        }
        if (drivers.some((d) => !d.fullName.trim())) {
          return badRequest("Συμπλήρωσε ονοματεπώνυμο σε όλους τους οδηγούς");
        }
        // Πρώτη υπογραφή: το snapshot παίρνεται τώρα και δεν αλλάζει πια.
        if (!anySigned(drivers)) {
          const snapshot = await buildSnapshot(viewer!.tenantId!, current.bookingId);
          if (snapshot) data.snapshot = snapshot as unknown as Prisma.InputJsonValue;
        }
      }

      const now = new Date();
      drivers[index] = {
        ...drivers[index],
        signature,
        signedAt: signature ? now.toISOString() : null,
      };
      data.drivers = drivers as unknown as Prisma.InputJsonValue;

      const complete = allSigned(drivers);
      if (complete) {
        data.status = "SIGNED";
        data.isSigned = true;
        data.signedAt = now;
        data.signedIp = requestIp(req.headers);
      }

      // Συμβόλαιο + κράτηση σε ΜΙΑ transaction. Με την τελευταία υπογραφή η
      // κράτηση περνά σε ACTIVE — μόνο προς τα εμπρός (βλ. bookingLifecycle).
      const STALE = "STALE";
      let moved: Awaited<ReturnType<typeof advanceBookingWithContract>> = null;
      try {
        moved = await db.$transaction(async (tx) => {
          const result = await tx.contract.updateMany({
            where: { id: current.id, updatedAt: current.updatedAt, status: "DRAFT" },
            data,
          });
          if (result.count === 0) throw new Error(STALE);
          if (!complete) return null;

          await tx.booking.update({
            where: { id: current.bookingId },
            data: { contractSigned: true, signedAt: now },
          });
          return advanceBookingWithContract(tx, viewer!.tenantId!, current.bookingId, "ACTIVE");
        });
      } catch (error) {
        if (error instanceof Error && error.message === STALE) {
          return conflict("Το συμβόλαιο άλλαξε στο μεταξύ. Φόρτωσε ξανά και δοκίμασε.");
        }
        throw error;
      }

      await refreshSearchText(current.id);
      if (moved) await syncVehicleStatus(moved.vehicleId, viewer!.tenantId!);

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
