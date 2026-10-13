"use client";

// «Η σελίδα μου» — καρτέλες. Η επιλεγμένη καρτέλα μένει στο URL (?tab=…),
// ώστε ένα refresh ή ένα link να ανοίγει στο ίδιο σημείο. Κάθε καρτέλα
// φορτώνει μόνη της τα δεδομένα της από το /api/public-site/*.

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n/I18nProvider";
import { AgesTab, GroupsTab, LocationsTab } from "./ListTabs";
import RatesTab from "./RatesTab";
import PromotionsTab from "./PromotionsTab";
import { AppearanceTab, BookingTab, ExtrasTab, TrustTab } from "./SettingsTabs";

export const TABS = ["page", "appearance", "groups", "locations", "rates", "promotions", "ages", "extras", "booking", "trust"] as const;
export type TabKey = (typeof TABS)[number];

const LABEL: Record<TabKey, string> = {
  page: "tabPage",
  appearance: "tabAppearance",
  groups: "tabGroups",
  locations: "tabLocations",
  rates: "tabRates",
  promotions: "tabPromotions",
  ages: "tabAges",
  extras: "tabExtras",
  booking: "tabBooking",
  trust: "tabTrust",
};

export default function StorefrontTabs({ page }: { page: React.ReactNode }) {
  const tr = useT();
  const router = useRouter();
  const params = useSearchParams();
  const fromUrl = params.get("tab");
  const [tab, setTab] = useState<TabKey>(TABS.includes(fromUrl as TabKey) ? (fromUrl as TabKey) : "page");

  useEffect(() => {
    if (TABS.includes(fromUrl as TabKey)) setTab(fromUrl as TabKey);
  }, [fromUrl]);

  const select = (next: TabKey) => {
    setTab(next);
    router.replace(next === "page" ? "?" : `?tab=${next}`, { scroll: false });
  };

  return (
    <>
      <nav className="dash-ps-tabs" aria-label={tr("storefront.title")}>
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            className={`dash-ps-tab ${tab === k ? "active" : ""}`}
            aria-current={tab === k ? "page" : undefined}
            onClick={() => select(k)}
          >
            {tr(`publicSite.${LABEL[k]}`)}
          </button>
        ))}
      </nav>
      <div className="dash-ps-panel">
        {tab === "page" && page}
        {tab === "appearance" && <AppearanceTab />}
        {tab === "groups" && <GroupsTab />}
        {tab === "locations" && <LocationsTab />}
        {tab === "rates" && <RatesTab />}
        {tab === "promotions" && <PromotionsTab />}
        {tab === "ages" && <AgesTab />}
        {tab === "extras" && <ExtrasTab />}
        {tab === "booking" && <BookingTab />}
        {tab === "trust" && <TrustTab />}
      </div>
    </>
  );
}
