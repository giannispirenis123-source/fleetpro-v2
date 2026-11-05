// /dashboard/partner-commissions — «Προμήθειες συνεργατών» (Διαχειριστής· προσωπικό με «commission.partners»).
import { redirect } from "next/navigation";
import { isPartner, pageGuard } from "@/lib/authz";
import { currentMonth } from "@/lib/finance";
import { loadPartnerCommissions } from "@/lib/partnerServer";
import PartnerCommissionsClient from "./PartnerCommissionsClient";

export const dynamic = "force-dynamic";

export default async function PartnerCommissionsPage() {
  // Ίδιο κλειδί με το API· ο συνεργάτης δεν το έχει ποτέ (PARTNER_NEVER).
  const guard = await pageGuard("commission.partners");
  if (!guard || isPartner(guard.viewer)) redirect("/dashboard");
  // Ίδια ημερομηνία αναφοράς με τα «Οικονομικά» του συνεργάτη.
  const month = currentMonth();
  const initial = await loadPartnerCommissions(guard.session.tenantId, month);
  return <PartnerCommissionsClient initialMonth={month} initial={initial} />;
}
