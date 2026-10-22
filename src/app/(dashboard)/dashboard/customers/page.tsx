import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { loadCustomerPage } from "@/lib/listServer";
import CustomersClient from "./CustomersClient";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  // Ο φύλακας διαβάζει το ΙΔΙΟ κλειδί με το API: καμία σελίδα δεν δείχνει
  // κάτι που ο server θα αρνιόταν.
  const guard = await pageGuard("customers.view");
  if (!guard) redirect("/dashboard");
  const { session } = guard;

  // Πρώτη σελίδα (50) από τη βάση: η σελίδα έρχεται ήδη γεμάτη· οι επόμενες από το API.
  const initialPage = await loadCustomerPage(session.tenantId, {});

  return <CustomersClient initialPage={initialPage} />;
}
