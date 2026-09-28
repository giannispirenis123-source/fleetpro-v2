export const dynamic = "force-dynamic";
// src/app/api/damages/route.ts
// Ζημιές οχημάτων — λίστα και καταχώρηση.
//
// Η ζημιά αφορά ΠΑΝΤΑ όχημα. Η κράτηση είναι προαιρετική: μια γρατζουνιά
// μπορεί να βρεθεί στο πάρκινγκ, χωρίς κανείς να την έχει νοικιάσει.

import { db } from "@/lib/db";
import { ok, created, badRequest, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { DAMAGE_INCLUDE, toDamageDTO } from "@/lib/service";
import {
  damageSchema,
  toDate,
  trimOrNull,
  vehicleBelongs,
  bookingMatches,
} from "@/lib/serviceForm";

// GET /api/damages
export const GET = withPermission(
  async (req, session) => {
    try {
      const url = new URL(req.url);
      const vehicleId = url.searchParams.get("vehicleId");
      const status = url.searchParams.get("status");

      const damages = await db.damage.findMany({
        where: {
          tenantId: session.tenantId!,
          ...(vehicleId ? { vehicleId } : {}),
          ...(status ? { status: status as never } : {}),
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        include: DAMAGE_INCLUDE,
      });

      return ok(damages.map(toDamageDTO));
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "damages.view"
);

// POST /api/damages
export const POST = withPermission(
  async (req, session) => {
    try {
      const parsed = damageSchema.safeParse(await req.json());
      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;

      if (!(await vehicleBelongs(data.vehicleId, session.tenantId!))) {
        return badRequest("Το όχημα δεν βρέθηκε");
      }

      // Αν δόθηκε κράτηση, πρέπει να είναι κράτηση ΑΥΤΟΥ του οχήματος:
      // αλλιώς η ζημιά θα χρεωνόταν σε λάθος ενοικίαση.
      const bookingId = data.bookingId?.trim() || null;
      if (
        bookingId &&
        !(await bookingMatches(bookingId, data.vehicleId, session.tenantId!))
      ) {
        return badRequest("Η κράτηση δεν αντιστοιχεί σε αυτό το όχημα");
      }

      const status = data.status ?? "PENDING";

      const damage = await db.damage.create({
        data: {
          tenantId: session.tenantId!,
          vehicleId: data.vehicleId,
          bookingId,
          description: data.description.trim(),
          date: toDate(data.date),
          repairCost: data.repairCost ?? null,
          status,
          resolvedAt: status === "RESOLVED" ? new Date() : null,
          notes: trimOrNull(data.notes),
          photos: [],
        },
        include: DAMAGE_INCLUDE,
      });

      return created({ damage: toDamageDTO(damage) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "damages.create"
);
