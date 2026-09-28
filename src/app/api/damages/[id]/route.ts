export const dynamic = "force-dynamic";
// src/app/api/damages/[id]/route.ts
// Επεξεργασία, επίλυση και διαγραφή ζημιάς.

import { db } from "@/lib/db";
import { ok, badRequest, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { DAMAGE_INCLUDE, toDamageDTO } from "@/lib/service";
import {
  damageUpdateSchema,
  toDate,
  trimOrNull,
  vehicleBelongs,
  bookingMatches,
} from "@/lib/serviceForm";

// PATCH /api/damages/[id]
export const PATCH = withPermission(
  async (req, session, params) => {
    try {
      const current = await db.damage.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
      });
      if (!current) return notFound("Η ζημιά δεν βρέθηκε");

      const parsed = damageUpdateSchema.safeParse(await req.json());
      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;
      const vehicleId = data.vehicleId ?? current.vehicleId;

      if (
        data.vehicleId !== undefined &&
        !(await vehicleBelongs(data.vehicleId, session.tenantId!))
      ) {
        return badRequest("Το όχημα δεν βρέθηκε");
      }

      // Αν αλλάζει κράτηση Ή όχημα, ξαναελέγχουμε το ζευγάρι: αλλιώς μια
      // αλλαγή οχήματος θα άφηνε τη ζημιά δεμένη σε ξένη κράτηση.
      let bookingId = current.bookingId;
      if (data.bookingId !== undefined) bookingId = data.bookingId?.trim() || null;

      if (bookingId && (data.bookingId !== undefined || data.vehicleId !== undefined)) {
        if (!(await bookingMatches(bookingId, vehicleId, session.tenantId!))) {
          return badRequest("Η κράτηση δεν αντιστοιχεί σε αυτό το όχημα");
        }
      }

      // Η ημερομηνία επίλυσης ακολουθεί την κατάσταση, ώστε να μη μένει
      // ποτέ ασύμφωνη με αυτήν.
      const status = data.status ?? current.status;
      const resolvedAt =
        status === "RESOLVED"
          ? current.resolvedAt ?? new Date()
          : null;

      const damage = await db.damage.update({
        where: { id: current.id },
        data: {
          ...(data.vehicleId !== undefined && { vehicleId: data.vehicleId }),
          ...(data.bookingId !== undefined && { bookingId }),
          ...(data.description !== undefined && {
            description: data.description.trim(),
          }),
          ...(data.date !== undefined && { date: toDate(data.date) }),
          ...(data.repairCost !== undefined && { repairCost: data.repairCost }),
          ...(data.status !== undefined && { status }),
          ...(data.notes !== undefined && { notes: trimOrNull(data.notes) }),
          resolvedAt,
        },
        include: DAMAGE_INCLUDE,
      });

      return ok({ damage: toDamageDTO(damage) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "damages.edit"
);

// DELETE /api/damages/[id]
export const DELETE = withPermission(
  async (_req, session, params) => {
    try {
      const current = await db.damage.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
        select: { id: true },
      });
      if (!current) return notFound("Η ζημιά δεν βρέθηκε");

      await db.damage.delete({ where: { id: current.id } });

      return ok({ id: current.id });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "damages.delete"
);
