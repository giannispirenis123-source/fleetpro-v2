// /dashboard/partner/finance — «Οικονομικά» του συνεργάτη (μόνο οι δικές του κρατήσεις).
import { redirect } from "next/navigation";
import { isPartner, pageGuard } from "@/lib/authz";
import { currentMonth } from "@/lib/finance";
import { loadPartnerFinance } from "@/lib/partnerServer";
import PartnerFinanceClient from "./PartnerFinanceClient";

export const dynamic = "force-dynamic";

export default async function PartnerFinancePage() {
  const guard = await pageGuard("commission.view");
  if (!guard || !isPartner(guard.viewer)) redirect("/dashboard");
  const month = currentMonth();
  const initial = await loadPartnerFinance({ ...guard.viewer, tenantId: guard.session.tenantId }, month);
  return <PartnerFinanceClient initialMonth={month} initial={initial} />;
}
