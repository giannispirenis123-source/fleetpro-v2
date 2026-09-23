export const dynamic = "force-dynamic";
// src/app/api/settings/route.ts
// Ρυθμίσεις της εταιρίας του τρέχοντος χρήστη.
// Το tenantId έρχεται πάντα από το session — ποτέ από το body.

import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, serverError } from "@/lib/api";
import { MAX_PREP_MINUTES } from "@/lib/prepTime";

const RENTAL_MODES = ["BOOKING", "REQUEST"] as const;

const SELECT = {
  id: true,
  name: true,
  rentalMode: true,
  prepTimeMinutes: true,
  roundUpTotal: true,
} as const;

// Κάθε πεδίο προαιρετικό, αλλά τουλάχιστον ένα πρέπει να δοθεί: η σελίδα
// ρυθμίσεων στέλνει μόνο αυτό που άλλαξε.
const updateSettingsSchema = z
  .object({
    rentalMode: z.enum(RENTAL_MODES).optional(),
    prepTimeMinutes: z
      .number()
      .int("Ο χρόνος προετοιμασίας μετριέται σε ακέραια λεπτά")
      .min(0, "Ο χρόνος προετοιμασίας δεν μπορεί να είναι αρνητικός")
      .max(MAX_PREP_MINUTES, "Ο χρόνος προετοιμασίας δεν μπορεί να ξεπερνά τις 24 ώρες")
      .optional(),
    roundUpTotal: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Δεν δόθηκε καμία ρύθμιση προς αλλαγή",
  });

// GET /api/settings
export const GET = withAuth(
  async (_req, session) => {
    try {
      const tenant = await db.tenant.findUnique({
        where: { id: session.tenantId! },
        select: SELECT,
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

// PATCH /api/settings — τρόπος λειτουργίας και χρόνος προετοιμασίας
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
        data: {
          ...(parsed.data.rentalMode !== undefined && {
            rentalMode: parsed.data.rentalMode,
          }),
          ...(parsed.data.prepTimeMinutes !== undefined && {
            prepTimeMinutes: parsed.data.prepTimeMinutes,
          }),
          ...(parsed.data.roundUpTotal !== undefined && {
            roundUpTotal: parsed.data.roundUpTotal,
          }),
        },
        select: SELECT,
      });

      return ok(tenant);
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN"]
);
