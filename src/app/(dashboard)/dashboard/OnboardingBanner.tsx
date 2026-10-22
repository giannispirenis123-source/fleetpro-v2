"use client";

// Banner προόδου του onboarding (μόνο εταιρίες από /signup, μόνο Διαχειριστής)
// μέχρι να γίνουν τα βήματα Α, Β, Δ. Κρυφό μέσα στην ίδια τη σελίδα onboarding.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/I18nProvider";

export default function OnboardingBanner({ done, total }: { done: number; total: number }) {
  const tr = useT();
  if (usePathname()?.startsWith("/dashboard/onboarding")) return null;
  return (
    <div className="dash-onb-banner" role="status" data-testid="onboarding-banner">
      <span>
        <strong>{tr("onboarding.banner")}</strong> · {done}/{total} {tr("onboarding.bannerProgress")}
      </span>
      <progress max={total} value={done} aria-hidden="true" />
      <Link className="dash-btn dash-btn--primary" href="/dashboard/onboarding">
        {tr("onboarding.bannerCta")}
      </Link>
    </div>
  );
}
