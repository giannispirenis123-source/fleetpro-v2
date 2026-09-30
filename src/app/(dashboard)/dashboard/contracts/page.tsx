import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { loadContractList } from "@/lib/contractForm";
import ContractsClient from "./ContractsClient";

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  const guard = await pageGuard("contracts.view");
  if (!guard) redirect("/dashboard");

  const contracts = await loadContractList(guard.viewer, {});
  return <ContractsClient initialContracts={contracts} />;
}
