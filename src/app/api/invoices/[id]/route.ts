export const dynamic = "force-dynamic";
// src/app/api/invoices/[id]/route.ts
// Αλλαγή κατάστασης τιμολογίου — προς το παρόν «σήμανση ως εξοφλημένο»
// και η επαναφορά της.
//
// Τα ποσά ΔΕΝ αλλάζουν ποτέ από εδώ: ένα εκδομένο τιμολόγιο είναι
// παραστατικό, όχι πρόχειρο.

import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, serverError } from "@/lib/api";
import { INVOICE_RELATIONS, toInvoiceDTO } from "@/lib/invoices";

const patchSchema = z.object({
  status: z.enum(["PAID", "UNPAID"]),
  /** Τρόπος πληρωμής, μόνο όταν σημαίνεται ως εξοφλημένο. */
  paymentMethod: z.union([z.string(), z.null()]).optional(),
});

// PATCH /api/invoices/[id]
export const PATCH = withAuth(
  async (req, session, params) => {
    try {
      const current = await db.invoice.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
        select: { id: true, status: true },
      });
      if (!current) return notFound("Το τιμολόγιο δεν βρέθηκε");

      if (current.status === "CANCELLED") {
        return badRequest("Ακυρωμένο τιμολόγιο δεν αλλάζει κατάσταση");
      }

      const parsed = patchSchema.safeParse(await req.json());
      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const paid = parsed.data.status === "PAID";

      const invoice = await db.invoice.update({
        where: { id: current.id },
        data: {
          status: parsed.data.status,
          // Η ημερομηνία εξόφλησης μπαίνει μαζί με την εξόφληση και
          // φεύγει μαζί της, ώστε να μη μείνει ποτέ ασύμφωνη.
          paidAt: paid ? new Date() : null,
          ...(paid
            ? {
                ...(parsed.data.paymentMethod !== undefined && {
                  paymentMethod: parsed.data.paymentMethod?.trim() || null,
                }),
              }
            : { paymentMethod: null }),
        },
        include: INVOICE_RELATIONS,
      });

      return ok({ invoice: toInvoiceDTO(invoice) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN", "STAFF"]
);
