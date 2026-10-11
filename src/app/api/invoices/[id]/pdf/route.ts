export const dynamic = "force-dynamic";
// src/app/api/invoices/[id]/pdf/route.ts
// GET /api/invoices/[id]/pdf?lang=el|en → το τιμολόγιο ως PDF (λήψη).
//
// ΜΟΝΟ Διαχειριστής και Προσωπικό (ο συνεργάτης όχι, ακόμα κι αν έχει
// δικαίωμα προβολής). Η εταιρία έρχεται ΜΟΝΟ από τη συνεδρία· τιμολόγιο
// άλλης εταιρίας → 404.

import { NextResponse } from "next/server";
import { badRequest, forbidden, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { parseDocLang, invoicePdfFilename } from "@/lib/invoiceDocument";
import { INVOICE_EMAIL_MSG, canExportInvoice } from "@/lib/invoiceEmail";
import { fetchLogoBytes, loadInvoiceDoc } from "@/lib/invoiceServer";
import { buildInvoicePdf } from "@/lib/invoicePdf";

export const GET = withPermission(
  async (req, session, params, viewer) => {
    try {
      if (!canExportInvoice(viewer!.role) || !session.tenantId) return forbidden(INVOICE_EMAIL_MSG.role);

      const lang = parseDocLang(req.nextUrl.searchParams.get("lang"));
      if (!lang) return badRequest("Μη έγκυρη γλώσσα (el ή en)");

      const loaded = await loadInvoiceDoc(session.tenantId, params!.id);
      if (!loaded) return notFound(INVOICE_EMAIL_MSG.notFound);

      const pdf = await buildInvoicePdf({
        doc: loaded.doc,
        lang,
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
      console.error("[FleetPro] PDF τιμολογίου: σφάλμα", error instanceof Error ? error.name : "");
      return serverError();
    }
  },
  "invoices.view"
);
