import { redirect } from "next/navigation";
import { pageGuard, viewerCan } from "@/lib/authz";
import { loadContractList } from "@/lib/contractForm";
import ContractsClient from "./ContractsClient";

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  const guard = await pageGuard("contracts.view");
  if (!guard) redirect("/dashboard");

  const page = await loadContractList(guard.viewer, {});
  return (
    <ContractsClient
      initialPage={page}
      canCreate={viewerCan(guard.viewer, "contracts.create")}
      canWalkIn={
        viewerCan(guard.viewer, "contracts.create") &&
        viewerCan(guard.viewer, "bookings.create")
      }
    />
  );
}
