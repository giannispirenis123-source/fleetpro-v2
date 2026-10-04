// Σελίδα πελάτη /c/[token] — server-rendered, χωρίς login, μόνο ανάγνωση,
// δίγλωσση. Το ΙΔΙΟ ContractDocument με το Α4, σε «δημόσια» λειτουργία,
// με δεδομένα καθαρισμένα από το toPublicContract (καμία φωτογραφία
// διπλώματος, κανένα εσωτερικό id, καμία πληρωμή/κάρτα).
//
// Ληγμένο / ακυρωμένο / άγνωστο token → φιλική δίγλωσση σελίδα χωρίς ΚΑΝΕΝΑ
// στοιχείο συμβολαίου. Τα headers (noindex, no-store, no-referrer) μπαίνουν
// από το middleware, που αφήνει ελεύθερη ΜΟΝΟ αυτή τη διαδρομή.

import type { Metadata } from "next";
import { loadPublicContract } from "@/lib/contractForm";
import ContractDocument from "@/components/contracts/ContractDocument";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Συμβόλαιο ενοικίασης / Rental agreement",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default async function PublicContractPage({ params }: { params: { token: string } }) {
  const found = await loadPublicContract(params.token);

  if (!found) {
    return (
      <main className="cpub-page">
        <div className="cpub-gone" role="status">
          <h1>Το link δεν είναι πλέον διαθέσιμο</h1>
          <p>Για ένα αντίγραφο του συμβολαίου σας, επικοινωνήστε με την εταιρία ενοικίασης.</p>
          <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "16px 0" }} />
          <h1 lang="en">This link is no longer available</h1>
          <p lang="en">For a copy of your agreement, please contact the rental company.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="cpub-page">
      <ContractDocument
        contract={found.contract}
        fallbackVatRate={found.vatRate}
        logoUrl={found.logoUrl}
        mode="public"
      />
    </main>
  );
}
