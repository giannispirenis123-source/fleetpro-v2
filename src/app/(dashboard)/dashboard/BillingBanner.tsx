"use client";

// Banner συνδρομής (SQL 36): «μόνο ανάγνωση», απλήρωτη ή λήξη δοκιμής σε ≤ 7
// ημέρες. Κρυφό μέσα στην ίδια τη σελίδα «Συνδρομή». Η απαγόρευση εγγραφών
// γίνεται στον server (withAuth) — εδώ μόνο ενημέρωση.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";

export default function BillingBanner({
  kind,
  reason,
  until,
  days,
  isAdmin,
}: {
  kind: "read_only" | "trial" | "past_due";
  reason: string | null;
  until: string | null;
  days: number | null;
  isAdmin: boolean;
}) {
  const tr = useT();
  const locale = useLocale();
  if (usePathname()?.startsWith("/dashboard/billing")) return null;
  const date = until ? new Date(until).toLocaleDateString(locale === "el" ? "el-GR" : "en-GB", { timeZone: "Europe/Athens" }) : "";
  const text =
    kind === "read_only"
      ? `${tr(`billing.readOnly_${reason}`)} ${tr("billing.readOnlyNote")}`
      : kind === "past_due"
        ? tr("billing.pastDue").replace("{date}", date)
        : tr("billing.trialLeft").replace("{n}", String(days ?? 0)).replace("{date}", date);
  return (
    <div className={`dash-billing-banner dash-billing-banner--${kind}`} role="status" data-testid="billing-banner">
      <span>{text}</span>
      {isAdmin ? (
        <Link className="dash-btn dash-btn--primary" href="/dashboard/billing">
          {tr("billing.bannerCta")}
        </Link>
      ) : (
        kind === "read_only" && <span className="dash-billing-banner-note">{tr("billing.readOnlyStaff")}</span>
      )}
    </div>
  );
}
