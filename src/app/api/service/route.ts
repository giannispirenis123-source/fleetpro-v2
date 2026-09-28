export const dynamic = "force-dynamic";
// src/app/api/service/route.ts
// Εγγραφές service και ΚΤΕΟ — λίστα και δημιουργία.
// Κάθε ερώτημα φιλτράρει ΚΑΙ με tenantId από το session.

import { db } from "@/lib/db";
import { ok, created, badRequest, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { SERVICE_INCLUDE, toServiceDTO } from "@/lib/service";
import {
  serviceSchema,
  toDate,
  toDateOrNull,
  trimOrNull,
  vehicleBelongs,
} from "@/lib/serviceForm";

// GET /api/service
export const GET = withPermission(
  async (req, session) => {
    try {
      const vehicleId = new URL(req.url).searchParams.get("vehicleId");

      const records = await db.serviceRecord.findMany({
        where: {
          tenantId: session.tenantId!,
          ...(vehicleId ? { vehicleId } : {}),
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        include: SERVICE_INCLUDE,
      });

      return ok(records.map(toServiceDTO));
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "service.view"
);

// POST /api/service
export const POST = withPermission(
  async (req, session) => {
    try {
      const parsed = serviceSchema.safeParse(await req.json());
      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;

      // Όχημα άλλης εταιρίας δεν δέχεται εγγραφή, ό,τι id κι αν σταλεί.
      if (!(await vehicleBelongs(data.vehicleId, session.tenantId!))) {
        return badRequest("Το όχημα δεν βρέθηκε");
      }

      const record = await db.serviceRecord.create({
        data: {
          tenantId: session.tenantId!,
          vehicleId: data.vehicleId,
          type: data.type,
          date: toDate(data.date),
          cost: data.cost ?? null,
          shop: trimOrNull(data.shop),
          km: data.km ?? null,
          description: trimOrNull(data.notes),
          nextServiceDate: toDateOrNull(data.nextServiceDate),
          nextServiceKm: data.nextServiceKm ?? null,
          documents: [],
        },
        include: SERVICE_INCLUDE,
      });

      return created({ record: toServiceDTO(record) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "service.create"
);
