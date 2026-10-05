import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { db } from "@/lib/db";
import SettingsClient from "./SettingsClient";
import { signUrls } from "@/lib/storage";
import CompanyContractSettings from "./CompanyContractSettings";

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
      email: true,
      phone: true,
      address: true,
      region: true,
      vat: true,
      taxOffice: true,
      contractTermsEl: true,
      contractTermsEn: true,
      logoPath: true,
    },
  });
  if (!tenant) redirect("/dashboard");
  const logoUrl = tenant.logoPath
    ? ((await signUrls([tenant.logoPath])).get(tenant.logoPath) ?? null)
    : null;

  return (
    <>
      <SettingsClient
        companyName={tenant.name}
        initialRentalMode={tenant.rentalMode}
        initialPrepMinutes={tenant.prepTimeMinutes}
        initialRoundUp={tenant.roundUpTotal}
        initialVatRate={Number(tenant.vatRate)}
        initialIssueTrigger={tenant.invoiceIssueTrigger}
        initialSendMode={tenant.invoiceSendMode}
      />
      <CompanyContractSettings
        companyName={tenant.name}
        companyEmail={tenant.email}
        initialLogoUrl={logoUrl}
        initial={{
          phone: tenant.phone ?? "",
          address: tenant.address ?? "",
          region: tenant.region ?? "",
          vat: tenant.vat ?? "",
          taxOffice: tenant.taxOffice ?? "",
          contractTermsEl: tenant.contractTermsEl ?? "",
          contractTermsEn: tenant.contractTermsEn ?? "",
        }}
      />
    </>
  );
}
