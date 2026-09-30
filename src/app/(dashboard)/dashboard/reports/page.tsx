import { redirect } from "next/navigation";
import { isPartner, pageGuard } from "@/lib/authz";
import { currentYear } from "@/lib/reports";
import { loadReport, loadYears } from "@/lib/reportsQuery";
import ReportsClient from "./ReportsClient";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const guard = await pageGuard("reports.view");
  // Ο συνεργάτης δεν βλέπει σύνολα εταιρίας, ακόμη κι αν του δοθεί το δικαίωμα.
  if (!guard || isPartner(guard.viewer)) redirect("/dashboard");

  const tenantId = guard.session.tenantId;
  const year = currentYear();

  const [report, years] = await Promise.all([
    loadReport(tenantId, year),
    loadYears(tenantId),
  ]);

  return <ReportsClient initialReport={report} years={years} />;
}
