import { redirect } from "next/navigation";
import { pageGuard, viewerCan } from "@/lib/authz";
import { db } from "@/lib/db";
import { currentMonth, monthRange } from "@/lib/finance";
import { loadExpenses, loadSummary } from "@/lib/financeForm";
import FinanceClient from "./FinanceClient";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const guard = await pageGuard("finance.view");
  if (!guard) redirect("/dashboard");
  const { session, viewer } = guard;

  const tenantId = session.tenantId;
  const month = currentMonth();
  const range = monthRange(month);

  const [summary, expenses, vehicles] = await Promise.all([
    loadSummary(tenantId, range),
    loadExpenses(tenantId, { range }),
    // Και τα ανενεργά: ένα παλιό έξοδο μπορεί να αφορά όχημα που πουλήθηκε.
    db.vehicle.findMany({
      where: { tenantId },
      orderBy: [{ isActive: "desc" }, { brand: "asc" }, { model: "asc" }],
      select: { id: true, brand: true, model: true, plate: true },
    }),
  ]);

  return (
    <FinanceClient
      initialMonth={month}
      initialSummary={summary}
      initialExpenses={expenses}
      vehicles={vehicles.map((v) => ({
        id: v.id,
        label: `${v.brand} ${v.model} · ${v.plate}`,
      }))}
      can={{
        create: viewerCan(viewer, "finance.create"),
        edit: viewerCan(viewer, "finance.edit"),
        delete: viewerCan(viewer, "finance.delete"),
      }}
    />
  );
}
