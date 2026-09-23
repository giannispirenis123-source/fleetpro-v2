export const dynamic = "force-dynamic";
// src/app/api/invoices/route.ts
// Τιμολόγια της εταιρίας — λίστα και χειροκίνητη έκδοση.
// Κάθε ερώτημα φιλτράρει ΚΑΙ με tenantId από το session.
//
// Ο client δεν στέλνει ΠΟΤΕ ποσά: στέλνει μόνο το id της κράτησης. Η
// καθαρή αξία, ο ΦΠΑ και το σύνολο βγαίνουν στον server από το ποσό της
// κράτησης και το ποσοστό ΦΠΑ της εταιρίας.

import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, ok, created, badRequest, serverError } from "@/lib/api";
import { INVOICE_RELATIONS, toInvoiceDTO } from "@/lib/invoices";
import { issueInvoiceForBooking } from "@/lib/invoiceIssue";

const issueSchema = z.object({
  bookingId: z.string().min(1, "Δώσε κράτηση"),
});

// GET /api/invoices
export const GET = withAuth(
  async (_req, session) => {
    try {
      const invoices = await db.invoice.findMany({
        where: { tenantId: session.tenantId! },
        orderBy: { issueDate: "desc" },
        include: INVOICE_RELATIONS,
      });

      return ok(invoices.map(toInvoiceDTO));
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN", "STAFF"]
);

// POST /api/invoices — χειροκίνητη έκδοση για μια κράτηση
export const POST = withAuth(
  async (req, session) => {
    try {
      const parsed = issueSchema.safeParse(await req.json());
      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const outcome = await issueInvoiceForBooking({
        tenantId: session.tenantId!,
        bookingId: parsed.data.bookingId,
      });

      if (!outcome.ok) return badRequest(outcome.message);

      const invoice = await db.invoice.findFirst({
        where: { id: outcome.invoiceId, tenantId: session.tenantId! },
        include: INVOICE_RELATIONS,
      });
      if (!invoice) return serverError();

      // created:false σημαίνει ότι υπήρχε ήδη — ο φύλακας δούλεψε. Δεν
      // είναι σφάλμα: επιστρέφουμε το υπάρχον τιμολόγιο ώστε η σελίδα να
      // δείξει το σωστό, χωρίς δεύτερη εγγραφή.
      const payload = {
        invoice: toInvoiceDTO(invoice),
        alreadyExisted: !outcome.created,
      };

      return outcome.created ? created(payload) : ok(payload);
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN", "STAFF"]
);
