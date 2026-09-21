export const dynamic = "force-dynamic";
// src/app/api/settings/route.ts
// Ρυθμίσεις της εταιρίας του τρέχοντος χρήστη.
// Το tenantId έρχεται πάντα από το session — ποτέ από το body.

import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, serverError } from "@/lib/api";

const RENTAL_MODES = ["BOOKING", "REQUEST"] as const;

const updateSettingsSchema = z.object({
  rentalMode: z.enum(RENTAL_MODES),
});

// GET /api/settings
export const GET = withAuth(
  async (_req, session) => {
    try {
      const tenant = await db.tenant.findUnique({
        where: { id: session.tenantId! },
        select: { id: true, name: true, rentalMode: true },
      });
      if (!tenant) return notFound("Η εταιρία δεν βρέθηκε");

      return ok(tenant);
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN", "STAFF"]
);

// PATCH /api/settings — αλλαγή τρόπου λειτουργίας
export const PATCH = withAuth(
  async (req, session) => {
    try {
      const body = await req.json();
      const parsed = updateSettingsSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const tenant = await db.tenant.update({
        where: { id: session.tenantId! },
        data: { rentalMode: parsed.data.rentalMode },
        select: { id: true, name: true, rentalMode: true },
      });

      return ok(tenant);
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN"]
);
