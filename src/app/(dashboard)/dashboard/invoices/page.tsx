import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { db } from "@/lib/db";
import { INVOICE_RELATIONS, toInvoiceDTO } from "@/lib/invoices";
import InvoicesClient from "./InvoicesClient";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  // Ο φύλακας διαβάζει το ΙΔΙΟ κλειδί με το API: καμία σελίδα δεν δείχνει
  // κάτι που ο server θα αρνιόταν.
  const guard = await pageGuard("invoices.view");
  if (!guard) redirect("/dashboard");
  const { session } = guard;

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
