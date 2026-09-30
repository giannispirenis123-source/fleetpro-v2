// Αντίγραφο εκτύπωσης συμβολαίου — σκέτη σελίδα Α4, χωρίς sidebar.
// Ίδιοι φύλακες με το API: contracts.view + στεγανότητα συνεργάτη.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { loadContract } from "@/lib/contractForm";
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

  const contract = await loadContract(guard.viewer, params.id);
  if (!contract) notFound();

  return (
    <main className="cdoc-page">
      <PrintToolbar backHref={`/dashboard/contracts/${contract.id}`} />
      <ContractDocument contract={contract} />
    </main>
  );
}
