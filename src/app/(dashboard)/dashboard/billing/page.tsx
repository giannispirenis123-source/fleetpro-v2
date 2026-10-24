import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadViewer } from "@/lib/authz";
import { billingOverview } from "@/lib/billing/billingServer";
import BillingClient from "./BillingClient";

export const dynamic = "force-dynamic";

// «Συνδρομή» — ΜΟΝΟ Διαχειριστής (ρόλος από τη βάση). Η εταιρία από τη
// συνεδρία· οι ενέργειες (Checkout, Πύλη) πάνε στα /api/billing/*, που
// ελέγχουν ξανά τα ίδια στον server.
export default async function BillingPage({ searchParams }: { searchParams: { checkout?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const viewer = await loadViewer(session);
  if (!viewer?.tenantId) redirect("/login");
  if (viewer.role !== "COMPANY_ADMIN") redirect("/dashboard");

  const overview = await billingOverview(viewer.tenantId);
  if (!overview) redirect("/dashboard");
  const checkout = searchParams.checkout === "success" || searchParams.checkout === "cancel" ? searchParams.checkout : null;
  return <BillingClient initial={overview} checkout={checkout} />;
}
