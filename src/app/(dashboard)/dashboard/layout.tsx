import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadViewer } from "@/lib/authz";
import { db } from "@/lib/db";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { t } from "@/lib/i18n";
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

  // Τα δικαιώματα διαβάζονται από τη βάση, όχι από το token: αλλαγή από
  // τον διαχειριστή ισχύει στην επόμενη φόρτωση, όχι σε 7 ημέρες.
  // Απενεργοποιημένος χρήστης με ζωντανό cookie βγαίνει έξω.
  const viewer = await loadViewer(session);
  if (!viewer) redirect("/login");

  // Όνομα εταιρίας για το sidebar
  const tenant = await db.tenant.findUnique({
    where: { id: session.tenantId },
    select: { name: true },
  });

  const locale = session.locale;

  return (
    <I18nProvider locale={locale}>
      <div className="dash-shell">
        <DashboardSidebar
          name={session.name}
          role={session.role}
          permissions={viewer.permissions}
          companyName={tenant?.name ?? t("common.myCompany", locale)}
        />
        <main className="dash-main">{children}</main>
      </div>
    </I18nProvider>
  );
}
