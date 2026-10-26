import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadViewer } from "@/lib/authz";
import { db } from "@/lib/db";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { t } from "@/lib/i18n";
import { getEntitlements } from "@/lib/entitlements";
import { onboardingBanner } from "@/lib/signup/onboardingServer";
import DashboardSidebar from "./DashboardSidebar";
import OnboardingBanner from "./OnboardingBanner";
import BillingBanner from "./BillingBanner";
import { billingAccess, billingNow, daysLeft, testClocksEnabled } from "@/lib/billing/core";
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
  const [tenant, me, entitlements, onboarding] = await Promise.all([
    db.tenant.findUnique({
      where: { id: session.tenantId },
      select: { name: true, billingStatus: true, trialEndsAt: true, pastDueSince: true, stripeTestClockId: true, billingClockAt: true },
    }),
    // Όνομα/email για το μενού λογαριασμού — από τη βάση (όχι από το JWT).
    db.user.findUnique({ where: { id: viewer.userId }, select: { name: true, email: true } }),
    getEntitlements(session.tenantId),
    // Πρόοδος onboarding (μόνο εταιρίες από /signup) — μόνο για τον Διαχειριστή.
    viewer.role === "COMPANY_ADMIN" ? onboardingBanner(session.tenantId) : Promise.resolve(null),
  ]);

  const locale = session.locale;

  // Συνδρομή (SQL 36): «μόνο ανάγνωση» ή προειδοποίηση (λήξη δοκιμής / απλήρωτη).
  // Ώρα: του test clock μόνο στο Preview με ενεργά clocks (SQL 37).
  const billingTime = tenant ? billingNow(tenant, new Date(), testClocksEnabled(process.env)) : new Date();
  const access = tenant ? billingAccess(tenant, billingTime) : null;
  const billingBanner =
    access?.mode === "read_only"
      ? { kind: "read_only" as const, reason: access.reason, until: null, days: null }
      : access?.warning === "past_due" ||
          (access?.warning === "trial" && viewer.role === "COMPANY_ADMIN" && (daysLeft(access.until, billingTime) ?? 99) <= 7)
        ? { kind: access.warning, reason: null, until: access.until?.toISOString() ?? null, days: daysLeft(access.until, billingTime) }
        : null;

  return (
    <I18nProvider locale={locale}>
      <div className="dash-shell">
        <DashboardSidebar
          name={me?.name ?? session.name}
          email={me?.email ?? session.email}
          role={session.role}
          permissions={viewer.permissions}
          companyName={tenant?.name ?? t("common.myCompany", locale)}
          modules={entitlements.modules}
        />
        <main className="dash-main">
          {billingBanner && <BillingBanner {...billingBanner} isAdmin={viewer.role === "COMPANY_ADMIN"} />}
          {onboarding && <OnboardingBanner done={onboarding.done} total={onboarding.total} />}
          {children}
        </main>
      </div>
    </I18nProvider>
  );
}
