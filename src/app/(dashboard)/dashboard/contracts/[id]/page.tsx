import { notFound, redirect } from "next/navigation";
import { pageGuard, viewerCan } from "@/lib/authz";
import { db } from "@/lib/db";
import { loadContract } from "@/lib/contractForm";
import ContractEditor from "./ContractEditor";

export const dynamic = "force-dynamic";

export default async function ContractPage({ params }: { params: { id: string } }) {
  const guard = await pageGuard("contracts.view");
  if (!guard) redirect("/dashboard");
  const { session, viewer } = guard;

  const [contract, vehicles] = await Promise.all([
    loadContract(viewer, params.id),
    // Για την αλλαγή οχήματος: μόνο τα ενεργά οχήματα του στόλου.
    db.vehicle.findMany({
      where: { tenantId: session.tenantId, isActive: true },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
      select: { id: true, brand: true, model: true, plate: true },
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
      can={{
        edit: viewerCan(viewer, "contracts.edit"),
        delete: viewerCan(viewer, "contracts.delete"),
      }}
    />
  );
}
