export const dynamic = "force-dynamic";
// src/app/api/settings/route.ts
// Ρυθμίσεις της εταιρίας του τρέχοντος χρήστη.
// Το tenantId έρχεται πάντα από το session — ποτέ από το body.

import { z } from "zod";
import { db } from "@/lib/db";
import { ok, badRequest, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { MAX_PREP_MINUTES } from "@/lib/prepTime";
import { INVOICE_ISSUE_TRIGGERS, INVOICE_SEND_MODES } from "@/lib/invoices";

const RENTAL_MODES = ["BOOKING", "REQUEST"] as const;

const SELECT = {
  id: true,
  name: true,
  rentalMode: true,
  prepTimeMinutes: true,
  roundUpTotal: true,
  vatRate: true,
  invoiceIssueTrigger: true,
  invoiceSendMode: true,
} as const;

/** Decimal → number, ώστε ο client να μη λαμβάνει ποτέ ΦΠΑ ως κείμενο. */
const toSettingsDTO = (t: {
  id: string;
  name: string;
  rentalMode: string;
  prepTimeMinutes: number;
  roundUpTotal: boolean;
  vatRate: unknown;
  invoiceIssueTrigger: string;
  invoiceSendMode: string;
}) => ({ ...t, vatRate: Number(t.vatRate) });

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
    // Ποσοστό ΦΠΑ. Οι τιμές των κρατήσεων το ΠΕΡΙΕΧΟΥΝ ήδη — το ποσοστό
    // λέει μόνο πώς σπάει το ποσό σε καθαρή αξία και ΦΠΑ.
    vatRate: z
      .number()
      .min(0, "Ο ΦΠΑ δεν μπορεί να είναι αρνητικός")
      .max(100, "Ο ΦΠΑ δεν μπορεί να ξεπερνά το 100%")
      .optional(),
    invoiceIssueTrigger: z.enum(INVOICE_ISSUE_TRIGGERS).optional(),
    invoiceSendMode: z.enum(INVOICE_SEND_MODES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Δεν δόθηκε καμία ρύθμιση προς αλλαγή",
  });

// GET /api/settings
export const GET = withPermission(
  async (_req, session) => {
    try {
      const tenant = await db.tenant.findUnique({
        where: { id: session.tenantId! },
        select: SELECT,
      });
      if (!tenant) return notFound("Η εταιρία δεν βρέθηκε");

      return ok(toSettingsDTO(tenant));
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "settings.view"
);

// PATCH /api/settings — τρόπος λειτουργίας και χρόνος προετοιμασίας
export const PATCH = withPermission(
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
          ...(parsed.data.vatRate !== undefined && {
            vatRate: parsed.data.vatRate,
          }),
          ...(parsed.data.invoiceIssueTrigger !== undefined && {
            invoiceIssueTrigger: parsed.data.invoiceIssueTrigger,
          }),
          ...(parsed.data.invoiceSendMode !== undefined && {
            invoiceSendMode: parsed.data.invoiceSendMode,
          }),
        },
        select: SELECT,
      });

      return ok(toSettingsDTO(tenant));
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "settings.edit"
);
