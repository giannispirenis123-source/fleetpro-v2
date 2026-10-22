import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { db } from "@/lib/db";
import { loadInvoicePage } from "@/lib/listServer";
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

  const [initialPage, tenant] = await Promise.all([
    // Πρώτη σελίδα (50)· φίλτρα, αναζήτηση και επόμενες σελίδες από το API.
    loadInvoicePage(tenantId, {}),
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
      initialPage={initialPage}
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
