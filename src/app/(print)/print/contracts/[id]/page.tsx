// Αντίγραφο εκτύπωσης συμβολαίου — σκέτη σελίδα Α4, χωρίς sidebar.
// Ίδιοι φύλακες με το API: contracts.view + στεγανότητα συνεργάτη.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { loadContract, refreshDraftSnapshot, tenantLogoUrl } from "@/lib/contractForm";
import { contractQrSvg } from "@/lib/contractQr";
import { db } from "@/lib/db";
import ContractDocument from "@/components/contracts/ContractDocument";
import PrintToolbar from "@/components/contracts/PrintToolbar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Συμβόλαιο / Rental agreement",
  robots: { index: false, follow: false },
};

export default async function ContractPrintPage({ params }: { params: { id: string } }) {
  const guard = await pageGuard("contracts.view");
  if (!guard) redirect("/dashboard");

  await refreshDraftSnapshot(guard.viewer, params.id);
  const [contract, tenant, logoUrl] = await Promise.all([
    loadContract(guard.viewer, params.id),
    // Μόνο για παλιά snapshot χωρίς ΦΠΑ· τα νέα έχουν το δικό τους.
    db.tenant.findUnique({ where: { id: guard.session.tenantId! }, select: { vatRate: true } }),
    tenantLogoUrl(guard.session.tenantId!),
  ]);
  if (!contract) notFound();
  // QR μόνο όταν υπάρχει ΕΝΕΡΓΟ link πελάτη.
  const qrSvg =
    contract.publicLink.state === "active" && contract.publicLink.token
      ? await contractQrSvg(contract.publicLink.token)
      : null;

  return (
    <main className="cdoc-page">
      <PrintToolbar backHref={`/dashboard/contracts/${contract.id}`} />
      <ContractDocument
        contract={contract}
        fallbackVatRate={Number(tenant?.vatRate ?? 24)}
        logoUrl={logoUrl}
        qrSvg={qrSvg}
      />
    </main>
  );
}
