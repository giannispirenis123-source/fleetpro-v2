export const dynamic = "force-dynamic";
// src/app/api/service/[id]/route.ts
// Επεξεργασία και διαγραφή εγγραφής service.

import { db } from "@/lib/db";
import { ok, badRequest, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { SERVICE_INCLUDE, toServiceDTO } from "@/lib/service";
import {
  serviceUpdateSchema,
  toDate,
  toDateOrNull,
  trimOrNull,
  vehicleBelongs,
} from "@/lib/serviceForm";

// PATCH /api/service/[id]
export const PATCH = withPermission(
  async (req, session, params) => {
    try {
      const current = await db.serviceRecord.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
        select: { id: true },
      });
      if (!current) return notFound("Η εγγραφή δεν βρέθηκε");

      const parsed = serviceUpdateSchema.safeParse(await req.json());
      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;

      if (
        data.vehicleId !== undefined &&
        !(await vehicleBelongs(data.vehicleId, session.tenantId!))
      ) {
        return badRequest("Το όχημα δεν βρέθηκε");
      }

      const record = await db.serviceRecord.update({
        where: { id: current.id },
        data: {
          ...(data.vehicleId !== undefined && { vehicleId: data.vehicleId }),
          ...(data.type !== undefined && { type: data.type }),
          ...(data.date !== undefined && { date: toDate(data.date) }),
          ...(data.cost !== undefined && { cost: data.cost }),
          ...(data.shop !== undefined && { shop: trimOrNull(data.shop) }),
          ...(data.km !== undefined && { km: data.km }),
          ...(data.notes !== undefined && {
            description: trimOrNull(data.notes),
          }),
          ...(data.nextServiceDate !== undefined && {
            nextServiceDate: toDateOrNull(data.nextServiceDate),
          }),
          ...(data.nextServiceKm !== undefined && {
            nextServiceKm: data.nextServiceKm,
          }),
        },
        include: SERVICE_INCLUDE,
      });

      return ok({ record: toServiceDTO(record) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "service.edit"
);

// DELETE /api/service/[id] — πραγματική διαγραφή.
// Μια λάθος καταχωρημένη εγγραφή συντήρησης δεν έχει λόγο να μείνει ως
// ιστορικό: δεν την κρατά κανένα άλλο παραστατικό.
export const DELETE = withPermission(
  async (_req, session, params) => {
    try {
      const current = await db.serviceRecord.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
        select: { id: true },
      });
      if (!current) return notFound("Η εγγραφή δεν βρέθηκε");

      await db.serviceRecord.delete({ where: { id: current.id } });

      return ok({ id: current.id });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "service.delete"
);
