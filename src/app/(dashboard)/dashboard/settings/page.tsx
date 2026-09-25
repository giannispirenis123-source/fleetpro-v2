import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { db } from "@/lib/db";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Ο φύλακας διαβάζει το ΙΔΙΟ κλειδί με το API: καμία σελίδα δεν δείχνει
  // κάτι που ο server θα αρνιόταν.
  const guard = await pageGuard("settings.view");
  if (!guard) redirect("/dashboard");
  const { session } = guard;

  const tenant = await db.tenant.findUnique({
    where: { id: session.tenantId },
    select: {
      name: true,
      rentalMode: true,
      prepTimeMinutes: true,
      roundUpTotal: true,
      vatRate: true,
      invoiceIssueTrigger: true,
      invoiceSendMode: true,
    },
  });
  if (!tenant) redirect("/dashboard");

  return (
    <SettingsClient
      companyName={tenant.name}
      initialRentalMode={tenant.rentalMode}
      initialPrepMinutes={tenant.prepTimeMinutes}
      initialRoundUp={tenant.roundUpTotal}
      initialVatRate={Number(tenant.vatRate)}
      initialIssueTrigger={tenant.invoiceIssueTrigger}
      initialSendMode={tenant.invoiceSendMode}
    />
  );
}
