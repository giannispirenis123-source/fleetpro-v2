import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { db } from "@/lib/db";
import { getEntitlements } from "@/lib/entitlements";
import { readLocalized } from "@/lib/public/text";
import { loadOnboarding } from "@/lib/signup/onboardingServer";
import { STOREFRONT_LANGUAGES, storefrontDictionary } from "@/lib/storefront/i18n";
import OnboardingClient from "./OnboardingClient";

export const dynamic = "force-dynamic";

// Onboarding μετά την εγγραφή — ΜΟΝΟ Διαχειριστής. Εταιρία χωρίς onboarding
// (π.χ. από τον Super Admin) → Πίνακας.
export default async function OnboardingPage() {
  const guard = await pageGuard("settings.edit");
  if (!guard || guard.viewer.role !== "COMPANY_ADMIN" || !guard.viewer.tenantId) redirect("/dashboard");
  const tenantId = guard.viewer.tenantId;
  // Συνδρομή σε «μόνο ανάγνωση» (π.χ. εγγραφή χωρίς κωδικό πριν από την κάρτα): πρώτα η «Συνδρομή».
  if (guard.viewer.readOnly) redirect("/dashboard/billing");

  const [initial, entitlements, groups] = await Promise.all([
    loadOnboarding(tenantId),
    getEntitlements(tenantId),
    db.rentalGroup.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, isActive: true },
    }),
  ]);
  if (!initial) redirect("/dashboard");

  return (
    <OnboardingClient
      initial={initial}
      languages={STOREFRONT_LANGUAGES.map((code) => ({ code, name: storefrontDictionary(code).langName }))}
      publicSite={entitlements.modules.publicSite}
      groups={groups.map((g) => ({
        id: g.id,
        label: `${g.code} · ${readLocalized(g.name).el ?? ""}`.trim(),
        isActive: g.isActive,
      }))}
    />
  );
}
