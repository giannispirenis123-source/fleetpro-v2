import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import DashboardSidebar from "./DashboardSidebar";
import "./dashboard.css";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  // Φύλακες πρόσβασης (το middleware τα καλύπτει, αλλά διπλή ασφάλεια)
  if (!session) redirect("/login");
  if (session.role === "SUPER_ADMIN") redirect("/super-admin");
  if (!session.tenantId) redirect("/login");

  // Όνομα εταιρίας για το sidebar
  const tenant = await db.tenant.findUnique({
    where: { id: session.tenantId },
    select: { name: true },
  });

  return (
    <div className="dash-shell">
      <DashboardSidebar
        name={session.name}
        role={session.role}
        companyName={tenant?.name ?? "Η εταιρία μου"}
      />
      <main className="dash-main">{children}</main>
    </div>
  );
}
