"use client";

// Καρτέλα «Προσφορές» (πίνακας promotions, SQL 21c) πάνω στο ResourceList.
// Κενή λίστα (τοποθεσίες, ομάδες, οχήματα, τύποι) = ισχύει για όλα.
// Οι προσφορές που έληξαν ΜΕΝΟΥΝ — δεν σβήνονται αυτόματα.

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/I18nProvider";
import { formatCents } from "@/lib/public/money";
import type { LocalizedText } from "@/lib/public/text";
import ResourceList from "./ResourceList";
import { Check, I18nInput, IntInput, MoneyInput, Select, api } from "./ui";

export interface PromotionItem {
  name: LocalizedText;
  badge: LocalizedText;
  isActive: boolean;
  discountType: "percent" | "per_day" | "per_rental";
  discountValue: number;
  validFrom: string;
  validTo: string;
  locationIds: string[];
  locationMatch: "pickup" | "dropoff" | "either";
  rentalGroupIds: string[];
  vehicleIds: string[];
  vehicleTypes: string[];
  minDays: number | null;
  sortOrder: number;
}

interface Option {
  id: string;
  label: string;
}

const el = (t: LocalizedText) => t.el || t.en || "";
const pad = (n: number) => String(n).padStart(2, "0");
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fmtDate = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");

/** Ενεργή τώρα / Μελλοντική / Έληξε — με βάση τις ημερομηνίες. */
export function promotionStatus(p: Pick<PromotionItem, "validFrom" | "validTo">, today: string): "now" | "future" | "expired" {
  if (p.validTo < today) return "expired";
  if (p.validFrom > today) return "future";
  return "now";
}

function toggle(list: string[], id: string, on: boolean): string[] {
  return on ? Array.from(new Set([...list, id])) : list.filter((x) => x !== id);
}

function Checks({
  label,
  options,
  selected,
  onChange,
  hint,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  hint: string;
}) {
  return (
    <div className="dash-field dash-field--wide">
      <span>{label}</span>
      <div className="dash-ps-checks">
        {options.map((o) => (
          <Check key={o.id} label={o.label} checked={selected.includes(o.id)} onChange={(on) => onChange(toggle(selected, o.id, on))} />
        ))}
      </div>
      <span className="dash-form-note">{hint}</span>
    </div>
  );
}

export default function PromotionsTab() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const [locations, setLocations] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [vehicles, setVehicles] = useState<Option[]>([]);
  const today = todayIso();

  useEffect(() => {
    api<{ items: { id: string; name: LocalizedText; isActive: boolean }[] }>("/api/public-site/locations").then((r) =>
      setLocations((r.data?.items ?? []).map((l) => ({ id: l.id, label: el(l.name) + (l.isActive ? "" : ` (${t("inactive")})`) })))
    );
    api<{ targets: { kind: "group" | "vehicle"; id: string; label: string }[] }>("/api/public-site/rates").then((r) => {
      const targets = r.data?.targets ?? [];
      setGroups(targets.filter((x) => x.kind === "group").map((x) => ({ id: x.id, label: x.label })));
      setVehicles(targets.filter((x) => x.kind === "vehicle").map((x) => ({ id: x.id, label: x.label })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = (p: PromotionItem) =>
    p.discountType === "percent"
      ? `-${p.discountValue}%`
      : `-${formatCents(p.discountValue)} ${t(p.discountType === "per_day" ? "perDayShort" : "perRentalShort")}`;

  return (
    <ResourceList<PromotionItem>
      resource="promotions"
      intro={t("promotionsIntro")}
      empty={() => ({
        name: {},
        badge: {},
        isActive: true,
        discountType: "percent",
        discountValue: 10,
        validFrom: today,
        validTo: plusDays(today, 30),
        locationIds: [],
        locationMatch: "pickup",
        rentalGroupIds: [],
        vehicleIds: [],
        vehicleTypes: [],
        minDays: null,
        sortOrder: 0,
      })}
      copy={(p) => {
        const { id: _id, ...rest } = p as PromotionItem & { id: string };
        return { ...rest, name: { ...p.name, el: `${el(p.name)} (${t("copySuffix")})` }, isActive: false };
      }}
      title={(p) => el(p.name)}
      summary={(p) => {
        const st = promotionStatus(p, today);
        return (
          <>
            <strong>{value(p)}</strong> · {fmtDate(p.validFrom)} – {fmtDate(p.validTo)}
            {p.minDays ? ` · ${t("minDays")}: ${p.minDays}` : ""}
            {p.locationIds.length > 0 && ` · ${p.locationIds.length} ${t("locationsShort")}`}
            <span className={`dash-ps-status dash-ps-status--${st}`}>{t(`promo_${st}`)}</span>
            {!p.isActive && <span className="dash-ps-badge">{t("inactive")}</span>}
          </>
        );
      }}
      extraActions={(p, save) => (
        <label className="dash-ps-switch" title={t("isActive")}>
          <input type="checkbox" checked={p.isActive} onChange={(e) => save({ ...p, isActive: e.target.checked })} />
          <span className="dash-ps-hide-xs">{p.isActive ? t("active") : t("inactive")}</span>
        </label>
      )}
      renderForm={(f) => {
        const v = f.value;
        return (
          <>
            <I18nInput label={t("promoName")} value={v.name} onChange={(x) => f.set("name", x)} maxLength={80} required />
            <I18nInput label={t("promoBadge")} value={v.badge} onChange={(x) => f.set("badge", x)} maxLength={60} required />
            <Select
              label={t("discountType")}
              value={v.discountType}
              options={(["percent", "per_day", "per_rental"] as const).map((x) => ({ value: x, label: t(`dt_${x}`) }))}
              onChange={(x) => {
                f.set("discountType", x);
                f.set("discountValue", x === "percent" ? 10 : 500);
                f.markInvalid("discountValue", false);
              }}
            />
            {v.discountType === "percent" ? (
              <IntInput
                label={t("discountPercent")}
                value={v.discountValue}
                onChange={(x) => f.set("discountValue", Math.max(1, Math.min(90, x ?? 1)))}
                min={1}
                max={90}
              />
            ) : (
              <MoneyInput
                key={v.discountType}
                label={t(v.discountType === "per_day" ? "discountPerDay" : "discountPerRental")}
                cents={v.discountValue}
                onChange={(c, ok) => {
                  f.markInvalid("discountValue", !ok || !c);
                  if (ok && c) f.set("discountValue", c);
                }}
              />
            )}
            <label className="dash-field">
              {t("validFrom")}
              <input type="date" value={v.validFrom} onChange={(e) => f.set("validFrom", e.target.value)} />
            </label>
            <label className="dash-field">
              {t("validTo")}
              <input type="date" value={v.validTo} min={v.validFrom} onChange={(e) => f.set("validTo", e.target.value)} />
            </label>
            <IntInput label={t("minDays")} value={v.minDays} onChange={(x) => f.set("minDays", x)} nullable min={1} max={365} />
            <IntInput label={t("sortOrder")} value={v.sortOrder} onChange={(x) => f.set("sortOrder", x ?? 0)} min={0} />
            <Check label={t("isActive")} checked={v.isActive} onChange={(x) => f.set("isActive", x)} />

            <Checks label={t("tabLocations")} options={locations} selected={v.locationIds} onChange={(x) => f.set("locationIds", x)} hint={t("emptyMeansAll")} />
            {v.locationIds.length > 0 && (
              <Select
                label={t("locationMatch")}
                value={v.locationMatch}
                options={(["pickup", "dropoff", "either"] as const).map((x) => ({ value: x, label: t(`lm_${x}`) }))}
                onChange={(x) => f.set("locationMatch", x)}
              />
            )}
            <Checks label={t("tabGroups")} options={groups} selected={v.rentalGroupIds} onChange={(x) => f.set("rentalGroupIds", x)} hint={t("emptyMeansAll")} />
            {vehicles.length > 0 && (
              <Checks label={t("ungroupedVehicles")} options={vehicles} selected={v.vehicleIds} onChange={(x) => f.set("vehicleIds", x)} hint={t("emptyMeansAll")} />
            )}
            <Checks
              label={t("vehicleTypes")}
              options={(["car", "moto", "atv"] as const).map((x) => ({ id: x, label: t(`vt_${x}`) }))}
              selected={v.vehicleTypes}
              onChange={(x) => f.set("vehicleTypes", x)}
              hint={t("emptyMeansAll")}
            />
            <p className="dash-form-note dash-field--wide">{t("promoNoStacking")}</p>
          </>
        );
      }}
    />
  );
}
