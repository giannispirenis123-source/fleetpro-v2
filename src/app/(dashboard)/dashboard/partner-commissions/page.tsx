// /dashboard/partner-commissions — «Προμήθειες συνεργατών» (Διαχειριστής· προσωπικό με «commission.partners»).
import { redirect } from "next/navigation";
import { isPartner, pageGuard } from "@/lib/authz";
import { currentMonth } from "@/lib/finance";
import { loadPartnerCommissions } from "@/lib/partnerServer";
import { parsePeriod } from "@/lib/partnerFinance";
import PartnerCommissionsClient from "./PartnerCommissionsClient";

export const dynamic = "force-dynamic";

export default async function PartnerCommissionsPage() {
  // Ίδιο κλειδί με το API· ο συνεργάτης δεν το έχει ποτέ (PARTNER_NEVER).
  const guard = await pageGuard("commission.partners");
  if (!guard || isPartner(guard.viewer)) redirect("/dashboard");
  // Ίδια ημερομηνία αναφοράς με τα «Οικονομικά» του συνεργάτη.
  const month = currentMonth();
  const p = parsePeriod({ month });
  const initial = await loadPartnerCommissions(guard.session.tenantId, p.ok ? p.period : { kind: "all" });
  return <PartnerCommissionsClient initialMonth={month} initial={initial} />;
}
