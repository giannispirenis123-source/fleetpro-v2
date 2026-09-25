import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { db } from "@/lib/db";
import { toCustomerDTO } from "@/lib/customers";
import CustomersClient from "./CustomersClient";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  // Ο φύλακας διαβάζει το ΙΔΙΟ κλειδί με το API: καμία σελίδα δεν δείχνει
  // κάτι που ο server θα αρνιόταν.
  const guard = await pageGuard("customers.view");
  if (!guard) redirect("/dashboard");
  const { session } = guard;

  // Αρχική λίστα από τη βάση: η σελίδα έρχεται ήδη γεμάτη, χωρίς loading state.
  const customers = await db.customer.findMany({
    where: { tenantId: session.tenantId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { _count: { select: { bookings: true } } },
  });

  return <CustomersClient initialCustomers={customers.map(toCustomerDTO)} />;
}
