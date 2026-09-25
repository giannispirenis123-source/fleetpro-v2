export const dynamic = "force-dynamic";
// src/app/api/extras/[id]/route.ts
// Επεξεργασία και ήπια διαγραφή πρόσθετου.
// Κάθε ερώτημα φιλτράρει ΚΑΙ με tenantId από το session.

import { z } from "zod";
import { db } from "@/lib/db";
import { ok, badRequest, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { CHARGE_TYPES, EXTRA_TYPES, toExtraDTO } from "@/lib/extras";

const updateExtraSchema = z.object({
  name: z.string().min(1).optional(),
  price: z.number().min(0).optional(),
  chargeType: z.enum(CHARGE_TYPES).optional(),
  type: z.enum(EXTRA_TYPES).optional(),
  isActive: z.boolean().optional(),
});

// PATCH /api/extras/[id]
export const PATCH = withPermission(
  async (req, session, params) => {
    try {
      const current = await db.extra.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
      });
      if (!current) return notFound("Το πρόσθετο δεν βρέθηκε");

      const body = await req.json();
      const parsed = updateExtraSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;

      const extra = await db.extra.update({
        where: { id: current.id },
        data: {
          ...(data.name !== undefined && { name: data.name.trim() }),
          ...(data.price !== undefined && { price: data.price }),
          ...(data.chargeType !== undefined && { chargeType: data.chargeType }),
          ...(data.type !== undefined && { type: data.type }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      });

      return ok({ extra: toExtraDTO(extra) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "extras.edit"
);

// DELETE /api/extras/[id] — ήπια διαγραφή.
// Το πρόσθετο μένει στη βάση ώστε παλιές κρατήσεις που το χρησιμοποίησαν
// (Βήμα 2) να μη χάσουν την αναφορά τους· απλώς παύει να προσφέρεται.
export const DELETE = withPermission(
  async (_req, session, params) => {
    try {
      const current = await db.extra.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
      });
      if (!current) return notFound("Το πρόσθετο δεν βρέθηκε");

      const extra = await db.extra.update({
        where: { id: current.id },
        data: { isActive: false },
      });

      return ok({ extra: toExtraDTO(extra) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "extras.delete"
);
