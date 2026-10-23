import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadViewer } from "@/lib/authz";
import { db } from "@/lib/db";
import AccountClient from "./AccountClient";

export const dynamic = "force-dynamic";

// «Ο λογαριασμός μου» — για ΟΛΟΥΣ τους ρόλους της εταιρίας (Admin, Staff,
// Partner): κανένα δικαίωμα, μόνο ενεργός χρήστης. Δείχνει ΜΟΝΟ τον ίδιο τον
// χρήστη (id από τη συνεδρία).
export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const viewer = await loadViewer(session);
  if (!viewer) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: viewer.userId },
    select: { name: true, email: true, role: true, tenant: { select: { name: true } } },
  });
  if (!user) redirect("/login");

  return <AccountClient name={user.name} email={user.email} role={user.role} companyName={user.tenant?.name ?? ""} />;
}
