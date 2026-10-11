import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { db } from "@/lib/db";
import { INVOICE_RELATIONS, toInvoiceDTO } from "@/lib/invoices";
import { canExportInvoice } from "@/lib/invoiceEmail";
import InvoicesClient from "./InvoicesClient";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  // Ο φύλακας διαβάζει το ΙΔΙΟ κλειδί με το API: καμία σελίδα δεν δείχνει
  // κάτι που ο server θα αρνιόταν.
  const guard = await pageGuard("invoices.view");
  if (!guard) redirect("/dashboard");
  const { session, viewer } = guard;

  const tenantId = session.tenantId;

  const [invoices, tenant] = await Promise.all([
    db.invoice.findMany({
      where: { tenantId },
      orderBy: { issueDate: "desc" },
      include: INVOICE_RELATIONS,
    }),
    db.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        address: true,
        phone: true,
        email: true,
        vat: true,
        iban: true,
      },
    }),
  ]);
  if (!tenant) redirect("/dashboard");

  return (
    <InvoicesClient
      initialInvoices={invoices.map(toInvoiceDTO)}
      // Λήψη PDF / αποστολή: μόνο Διαχειριστής και Προσωπικό (ο server ξαναελέγχει).
      canExport={canExportInvoice(viewer.role)}
      company={{
        name: tenant.name,
        address: tenant.address,
        phone: tenant.phone,
        email: tenant.email,
        vat: tenant.vat,
        iban: tenant.iban,
      }}
    />
  );
}
