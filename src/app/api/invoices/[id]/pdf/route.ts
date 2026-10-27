export const dynamic = "force-dynamic";
// src/app/api/invoices/[id]/pdf/route.ts
// GET /api/invoices/[id]/pdf → το τιμολόγιο ως ΔΙΓΛΩΣΣΟ PDF (λήψη). Το
// παλιό ?lang=el|en γίνεται δεκτό αλλά δεν αλλάζει τίποτα.
//
// ΜΟΝΟ Διαχειριστής και Προσωπικό (ο συνεργάτης όχι, ακόμα κι αν έχει
// δικαίωμα προβολής). Η εταιρία έρχεται ΜΟΝΟ από τη συνεδρία· τιμολόγιο
// άλλης εταιρίας → 404.

import { NextResponse } from "next/server";
import { forbidden, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { invoicePdfFilename } from "@/lib/invoiceDocument";
import { INVOICE_EMAIL_MSG, canExportInvoice } from "@/lib/invoiceEmail";
import { fetchLogoBytes, loadInvoiceDoc } from "@/lib/invoiceServer";
import { buildInvoicePdf } from "@/lib/invoicePdf";
import { AMOUNT_BLOCKED_MESSAGE, AmountIntegrityError } from "@/lib/public/outgoingAmounts";

export const GET = withPermission(
  async (_req, session, params, viewer) => {
    try {
      if (!canExportInvoice(viewer!.role) || !session.tenantId) return forbidden(INVOICE_EMAIL_MSG.role);

      // Το ?lang= μένει για συμβατότητα αλλά ΑΓΝΟΕΙΤΑΙ: το PDF είναι πάντα
      // δίγλωσσο (Ελληνικά + English).
      const loaded = await loadInvoiceDoc(session.tenantId, params!.id);
      if (!loaded) return notFound(INVOICE_EMAIL_MSG.notFound);

      const pdf = await buildInvoicePdf({
        doc: loaded.doc,
        logo: await fetchLogoBytes(loaded.logoPath),
      });

      const filename = invoicePdfFilename(loaded.doc.code);
      return new NextResponse(Buffer.from(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(pdf.byteLength),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      // Έλεγχος ποσών: ασυμφωνία → ΚΑΝΕΝΑ PDF (μόνο ο κωδικός στα logs).
      if (error instanceof AmountIntegrityError) {
        console.error(`[FleetPro] PDF τιμολογίου: μπλοκαρίστηκε από τον έλεγχο ποσών (${error.code})`);
        return NextResponse.json({ success: false, message: AMOUNT_BLOCKED_MESSAGE, code: "amount_blocked" }, { status: 409 });
      }
      console.error("[FleetPro] PDF τιμολογίου: σφάλμα", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "invoices.view"
);
