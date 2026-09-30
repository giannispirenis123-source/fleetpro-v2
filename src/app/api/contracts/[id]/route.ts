export const dynamic = "force-dynamic";
// src/app/api/contracts/[id]/route.ts
// Ένα συμβόλαιο: προβολή, επεξεργασία, διαγραφή πρόχειρου.
//
// Ο server κρίνει τι αλλάζει:
//  · DRAFT      → όλα. Αν αλλάξουν στοιχεία παραλαβής ενώ υπάρχουν
//                 υπογραφές, οι υπογραφές σβήνονται (άλλαξε ό,τι υπέγραψαν).
//  · SIGNED     → μόνο καύσιμο παράδοσης, αλλαγές οχήματος, παρατηρήσεις.
//  · COMPLETED  → τίποτα.

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, badRequest, conflict, notFound, noContent, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { anySigned, readDrivers } from "@/lib/contracts";
import { readExtrasSnapshot } from "@/lib/pricing";
import {
  CONTRACT_INCLUDE,
  buildSnapshot,
  cardsFor,
  extrasLockOf,
  priceBookingExtras,
  refreshSearchText,
  contractPatchSchema,
  contractScope,
  loadContract,
  mergeDrivers,
  pickupChanged,
  resolveVehicleChanges,
  toContractDTO,
} from "@/lib/contractForm";

// GET /api/contracts/[id]
export const GET = withPermission(
  async (_req, _session, params, viewer) => {
    try {
      const contract = await loadContract(viewer!, params!.id);
      if (!contract) return notFound("Το συμβόλαιο δεν βρέθηκε");
      return ok({ contract });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "contracts.view"
);

// PATCH /api/contracts/[id]
export const PATCH = withPermission(
  async (req, _session, params, viewer) => {
    try {
      const current = await db.contract.findFirst({
        where: { ...contractScope(viewer!), id: params!.id },
        include: {
          booking: { select: { status: true, extras: true, invoice: { select: { id: true } } } },
        },
      });
      if (!current) return notFound("Το συμβόλαιο δεν βρέθηκε");
      if (current.status === "COMPLETED") {
        return conflict("Το συμβόλαιο έχει ολοκληρωθεί και δεν αλλάζει");
      }

      const parsed = contractPatchSchema.safeParse(await req.json());
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      const patch = parsed.data;

      const locked = current.status === "SIGNED";
      const changed = pickupChanged(current, patch);
      if (locked && changed) {
        return conflict(
          "Το συμβόλαιο έχει υπογραφεί: τα στοιχεία παραλαβής είναι κλειδωμένα"
        );
      }

      const tenantId = viewer!.tenantId!;
      const data: Prisma.ContractUpdateManyMutationInput = {};

      /* ── Πρόσθετα: αλλάζουν ΚΑΙ την κράτηση ── */
      let bookingUpdate: Prisma.BookingUpdateInput | null = null;
      if (patch.extraIds !== undefined) {
        const now = readExtrasSnapshot(current.booking.extras).map((l) => l.id).sort();
        const next = Array.from(new Set(patch.extraIds)).sort();
        if (now.join(",") !== next.join(",")) {
          const lock = extrasLockOf(readDrivers(current.drivers), current.booking);
          if (lock || locked) {
            return conflict(
              lock === "invoiced"
                ? "Η κράτηση έχει τιμολόγιο: τα πρόσθετα δεν αλλάζουν"
                : lock === "closed"
                  ? "Η κράτηση έχει κλείσει: τα πρόσθετα δεν αλλάζουν"
                  : "Το συμβόλαιο έχει υπογραφές: τα πρόσθετα δεν αλλάζουν"
            );
          }
          // Ο ΙΔΙΟΣ υπολογισμός με το PATCH κράτησης — ποσά από τον client αγνοούνται.
          const priced = await priceBookingExtras(tenantId, current.bookingId, next);
          if (!priced.ok) return badRequest(priced.message);
          bookingUpdate = priced.data;
        }
      }

      /* ── Πάντα επιτρεπτά (εκτός COMPLETED) ── */
      if (patch.fuelReturn !== undefined) data.fuelReturn = patch.fuelReturn;
      if (patch.notes !== undefined) data.notes = patch.notes || null;
      if (patch.vehicleChanges !== undefined) {
        const resolved = await resolveVehicleChanges(tenantId, patch.vehicleChanges);
        if (!resolved.ok) return badRequest(resolved.message);
        data.vehicleChanges = resolved.changes as unknown as Prisma.InputJsonValue;
      }

      /* ── Στοιχεία παραλαβής — μόνο σε πρόχειρο ── */
      const currentDrivers = readDrivers(current.drivers);
      const signaturesReset = !locked && changed && anySigned(currentDrivers);
      let drivers = currentDrivers;

      if (!locked) {
        if (patch.drivers) {
          drivers = mergeDrivers(currentDrivers, patch.drivers, signaturesReset);
        } else if (signaturesReset) {
          drivers = currentDrivers.map((d) => ({ ...d, signature: null, signedAt: null }));
        }
        data.drivers = drivers as unknown as Prisma.InputJsonValue;

        if (patch.pickupLocation !== undefined) data.pickupLocation = patch.pickupLocation || null;
        if (patch.returnLocation !== undefined) data.returnLocation = patch.returnLocation || null;
        if (patch.fuelPickup !== undefined) data.fuelPickup = patch.fuelPickup;
        if (patch.damageMarks !== undefined) {
          data.damageMarks = patch.damageMarks as unknown as Prisma.InputJsonValue;
        }
        if (patch.paymentMethod !== undefined) data.paymentMethod = patch.paymentMethod;
        if (patch.depositAmount !== undefined) data.depositAmount = patch.depositAmount;
        if (patch.depositMethod !== undefined) data.depositMethod = patch.depositMethod;
        // Στοιχεία κάρτας μόνο με τρόπο «κάρτα»· αλλιώς σβήνονται.
        const cards = cardsFor(
          patch.paymentMethod !== undefined ? patch.paymentMethod : current.paymentMethod,
          patch.depositMethod !== undefined ? patch.depositMethod : current.depositMethod,
          patch,
          current
        );
        // Αποθηκεύονται ΜΟΝΟ τα 4 πεδία που επέτρεψε το strict zod schema.
        data.paymentCard = cards.paymentCard
          ? ({ ...cards.paymentCard } as Prisma.InputJsonObject)
          : Prisma.DbNull;
        data.depositCard = cards.depositCard
          ? ({ ...cards.depositCard } as Prisma.InputJsonObject)
          : Prisma.DbNull;
        if (patch.gdprConsent !== undefined && patch.gdprConsent !== current.gdprConsent) {
          data.gdprConsent = patch.gdprConsent;
          data.gdprConsentAt = patch.gdprConsent ? new Date() : null;
        }

      }

      // Κράτηση + snapshot + συμβόλαιο σε ΜΙΑ transaction: το σύνολο είναι
      // πάντα ίδιο στα δύο. Αν άλλος αποθήκευσε (ή υπέγραψε) στο μεταξύ,
      // τίποτα δεν γράφεται (αισιόδοξο κλείδωμα).
      const STALE = "STALE";
      try {
        await db.$transaction(async (tx) => {
          if (bookingUpdate) {
            await tx.booking.update({ where: { id: current.bookingId }, data: bookingUpdate });
          }
          // Όσο κανείς δεν έχει υπογράψει, το snapshot ακολουθεί την κράτηση
          // και τις ρυθμίσεις· με την πρώτη υπογραφή παγώνει.
          if (!locked && !anySigned(drivers)) {
            const snapshot = await buildSnapshot(tenantId, current.bookingId, tx);
            if (snapshot) data.snapshot = snapshot as unknown as Prisma.InputJsonValue;
          }
          const result = await tx.contract.updateMany({
            where: { id: current.id, updatedAt: current.updatedAt },
            data,
          });
          if (result.count === 0) throw new Error(STALE);
        });
      } catch (error) {
        if (error instanceof Error && error.message === STALE) {
          return conflict("Το συμβόλαιο άλλαξε στο μεταξύ. Φόρτωσε ξανά και δοκίμασε.");
        }
        throw error;
      }

      await refreshSearchText(current.id);

      const fresh = await db.contract.findUniqueOrThrow({
        where: { id: current.id },
        include: CONTRACT_INCLUDE,
      });
      return ok({ contract: toContractDTO(fresh), signaturesReset });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "contracts.edit"
);

// DELETE /api/contracts/[id] — μόνο πρόχειρο χωρίς υπογραφές.
export const DELETE = withPermission(
  async (_req, _session, params, viewer) => {
    try {
      const current = await db.contract.findFirst({
        where: { ...contractScope(viewer!), id: params!.id },
        select: { id: true, status: true, drivers: true, bookingId: true },
      });
      if (!current) return notFound("Το συμβόλαιο δεν βρέθηκε");

      if (current.status !== "DRAFT" || anySigned(readDrivers(current.drivers))) {
        return conflict("Υπογεγραμμένο συμβόλαιο δεν διαγράφεται");
      }

      await db.contract.delete({ where: { id: current.id } });
      return noContent();
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "contracts.delete"
);
