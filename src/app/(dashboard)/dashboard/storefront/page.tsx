import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { getSession } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { loadStorefrontAdmin, storefrontAccess } from "@/lib/storefront/admin";
import { STOREFRONT_LANGUAGES, storefrontDictionary } from "@/lib/storefront/i18n";
import { Suspense } from "react";
import StorefrontClient from "./StorefrontClient";
import StorefrontTabs from "./StorefrontTabs";

export const dynamic = "force-dynamic";

// «Η σελίδα μου» — ΜΟΝΟ Διαχειριστής. Χωρίς publicSite στο πακέτο: η
// οθόνη φαίνεται κλειδωμένη· το API αρνείται ούτως ή άλλως (storefrontAccess).
export default async function StorefrontAdminPage() {
  const guard = await pageGuard("settings.edit");
  if (!guard || guard.viewer.role !== "COMPANY_ADMIN") redirect("/dashboard");
  const locale = (await getSession())?.locale ?? "el";

  const access = await storefrontAccess(guard.viewer);
  if (!access.ok) {
    return (
      <>
        <div className="dash-page-head">
          <h1 className="dash-page-title">{t("storefront.title", locale)}</h1>
        </div>
        <div className="dash-panel dash-settings-panel">
          <h2 className="dash-section-title">{t("storefront.notInPlan", locale)}</h2>
          <p className="dash-form-note">{t("storefront.notInPlanText", locale)}</p>
        </div>
      </>
    );
  }

  const initial = await loadStorefrontAdmin(access.companyId);
  if (!initial) redirect("/dashboard");

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{t("storefront.title", locale)}</h1>
        <p className="dash-page-sub">{t("storefront.subtitle", locale)}</p>
      </div>
      <Suspense>
        <StorefrontTabs
          page={
            <StorefrontClient
              initial={initial}
              languages={STOREFRONT_LANGUAGES.map((code) => ({
                code,
                name: storefrontDictionary(code).langName,
              }))}
            />
          }
        />
      </Suspense>
    </>
  );
}
