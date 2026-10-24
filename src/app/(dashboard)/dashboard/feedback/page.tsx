import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadViewer } from "@/lib/authz";
import FeedbackClient from "./FeedbackClient";

export const dynamic = "force-dynamic";

// «Πες μας τη γνώμη σου» — για ΟΛΟΥΣ τους ρόλους της εταιρίας, προαιρετικό.
export default async function FeedbackPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const viewer = await loadViewer(session);
  if (!viewer?.tenantId) redirect("/login");
  return <FeedbackClient />;
}
