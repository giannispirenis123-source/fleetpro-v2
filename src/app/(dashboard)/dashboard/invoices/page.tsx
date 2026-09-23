import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { INVOICE_RELATIONS, toInvoiceDTO } from "@/lib/invoices";
import InvoicesClient from "./InvoicesClient";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "SUPER_ADMIN") redirect("/super-admin");
  if (!session.tenantId) redirect("/login");

  // Τα τιμολόγια είναι οικονομικό στοιχείο της εταιρίας: ο συνεργάτης
  // βλέπει κρατήσεις και στόλο, όχι παραστατικά.
  if (session.role !== "COMPANY_ADMIN" && session.role !== "STAFF") {
    redirect("/dashboard");
  }

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
