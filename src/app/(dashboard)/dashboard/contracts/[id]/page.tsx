import { notFound, redirect } from "next/navigation";
import { pageGuard, viewerCan } from "@/lib/authz";
import { db } from "@/lib/db";
import { loadContract, refreshDraftSnapshot } from "@/lib/contractForm";
import { toExtraDTO } from "@/lib/extras";
import ContractEditor from "./ContractEditor";

export const dynamic = "force-dynamic";

export default async function ContractPage({ params }: { params: { id: string } }) {
  const guard = await pageGuard("contracts.view");
  if (!guard) redirect("/dashboard");
  const { session, viewer } = guard;

  await refreshDraftSnapshot(viewer, params.id);

  const [contract, vehicles, extras, tenant] = await Promise.all([
    loadContract(viewer, params.id),
    // Για την αλλαγή οχήματος: μόνο τα ενεργά οχήματα του στόλου.
    db.vehicle.findMany({
      where: { tenantId: session.tenantId, isActive: true },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
      select: { id: true, brand: true, model: true, plate: true },
    }),
    // Τα πρόσθετα της εταιρίας για την ενότητα «Πρόσθετα / Extras».
    db.extra.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    db.tenant.findUnique({
      where: { id: session.tenantId },
      select: { vatRate: true, roundUpTotal: true },
    }),
  ]);
  if (!contract) notFound();

  return (
    <ContractEditor
      initialContract={contract}
      vehicles={vehicles.map((v) => ({
        id: v.id,
        label: `${v.brand} ${v.model} · ${v.plate}`,
      }))}
      extras={extras.map(toExtraDTO)}
      vatRate={Number(tenant?.vatRate ?? 24)}
      roundUpTotal={tenant?.roundUpTotal ?? false}
      can={{
        edit: viewerCan(viewer, "contracts.edit"),
        delete: viewerCan(viewer, "contracts.delete"),
      }}
    />
  );
}
