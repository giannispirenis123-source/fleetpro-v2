"use client";

// Καρτέλες: Ομάδες · Τοποθεσίες · Σεζόν · Ηλικίες οδηγού (πάνω στο ResourceList).

import VehiclePhotos from "@/components/photos/VehiclePhotos";
import { useT } from "@/lib/i18n/I18nProvider";
import { formatCents } from "@/lib/public/money";
import type { LocalizedText } from "@/lib/public/text";
import type { VehiclePhotoView } from "@/lib/vehiclePhotos";
import ResourceList, { type FormApi } from "./ResourceList";
import { Check, I18nInput, IntInput, MoneyInput, Select } from "./ui";

const FUELS = ["PETROL", "DIESEL", "HYBRID", "ELECTRIC", "LPG"] as const;
const el = (t: LocalizedText) => t.el || t.en || "";

/** Ποσό σε € που ενημερώνει και την εγκυρότητα της φόρμας. */
function money<T>(form: FormApi<T>, key: keyof T & string, label: string, opts: { nullable?: boolean; hint?: string; allowNegative?: boolean } = {}) {
  return (
    <MoneyInput
      key={key}
      label={label}
      cents={form.value[key] as unknown as number | null}
      nullable={opts.nullable}
      hint={opts.hint}
      allowNegative={opts.allowNegative}
      onChange={(c, valid) => {
        form.markInvalid(key, !valid);
        if (valid) form.set(key, c as T[typeof key]);
      }}
    />
  );
}

/* ─────────────────────────────────────────────
   Ομάδες
   ───────────────────────────────────────────── */

export interface GroupItem {
  code: string;
  vehicleType: "car" | "moto" | "atv";
  name: LocalizedText;
  description: LocalizedText;
  similarModels: LocalizedText;
  seats: number;
  doors: number | null;
  transmission: "manual" | "automatic";
  fuel: (typeof FUELS)[number];
  bagsLarge: number;
  bagsSmall: number;
  airCondition: boolean;
  engineCc: number | null;
  minDriverAge: number | null;
  licenceCategory: string | null;
  basePriceCents: number;
  depositCents: number | null;
  excessCents: number | null;
  sortOrder: number;
  isPublic: boolean;
  isActive: boolean;
  photos?: VehiclePhotoView[];
  vehicleCount?: number;
}

export function GroupsTab() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  return (
    <ResourceList<GroupItem>
      resource="groups"
      intro={`${t("groupsIntro")} ${t("noGroupHint")}`}
      empty={() => ({
        code: "",
        vehicleType: "car",
        name: {},
        description: {},
        similarModels: {},
        seats: 5,
        doors: 5,
        transmission: "manual",
        fuel: "PETROL",
        bagsLarge: 1,
        bagsSmall: 1,
        airCondition: true,
        engineCc: null,
        minDriverAge: null,
        licenceCategory: "B",
        basePriceCents: 0,
        depositCents: null,
        excessCents: null,
        sortOrder: 0,
        isPublic: true,
        isActive: true,
      })}
      title={(g) => `${g.code} · ${el(g.name)}`}
      summary={(g) => (
        <>
          {t(`vt_${g.vehicleType}`)} · {g.seats} {t("seats").toLowerCase()} · {t(`tr_${g.transmission}`)} ·{" "}
          {formatCents(g.basePriceCents)} · {t("vehicleCount")}: {g.vehicleCount ?? 0}
          {!g.isActive && <span className="dash-ps-badge">{t("inactive")}</span>}
        </>
      )}
      renderForm={(f) => {
        const v = f.value;
        return (
          <>
            <label className="dash-field">
              {t("code")} *
              <input value={v.code} maxLength={20} onChange={(e) => f.set("code", e.target.value.toUpperCase())} placeholder="B-MAN" />
            </label>
            <Select
              label={t("vehicleType")}
              value={v.vehicleType}
              options={(["car", "moto", "atv"] as const).map((x) => ({ value: x, label: t(`vt_${x}`) }))}
              onChange={(x) => f.set("vehicleType", x)}
            />
            <I18nInput label={t("name")} value={v.name} onChange={(x) => f.set("name", x)} maxLength={80} required />
            <I18nInput label={t("similarModels")} value={v.similarModels} onChange={(x) => f.set("similarModels", x)} maxLength={120} />
            <I18nInput label={t("description")} value={v.description} onChange={(x) => f.set("description", x)} maxLength={1000} multiline />
            <IntInput label={t("seats")} value={v.seats} onChange={(x) => f.set("seats", x ?? 1)} min={1} max={60} />
            <IntInput label={t("doors")} value={v.doors} onChange={(x) => f.set("doors", x)} nullable min={0} max={10} />
            <Select
              label={t("transmission")}
              value={v.transmission}
              options={(["manual", "automatic"] as const).map((x) => ({ value: x, label: t(`tr_${x}`) }))}
              onChange={(x) => f.set("transmission", x)}
            />
            <Select
              label={t("fuel")}
              value={v.fuel}
              options={FUELS.map((x) => ({ value: x, label: tr(`fuelType.${x}`) }))}
              onChange={(x) => f.set("fuel", x)}
            />
            <IntInput label={t("bagsLarge")} value={v.bagsLarge} onChange={(x) => f.set("bagsLarge", x ?? 0)} min={0} max={20} />
            <IntInput label={t("bagsSmall")} value={v.bagsSmall} onChange={(x) => f.set("bagsSmall", x ?? 0)} min={0} max={20} />
            <IntInput label={t("engineCc")} value={v.engineCc} onChange={(x) => f.set("engineCc", x)} nullable min={0} max={5000} />
            <IntInput label={t("minDriverAge")} value={v.minDriverAge} onChange={(x) => f.set("minDriverAge", x)} nullable min={16} max={99} />
            <label className="dash-field">
              {t("licenceCategory")}
              <input value={v.licenceCategory ?? ""} maxLength={10} onChange={(e) => f.set("licenceCategory", e.target.value || null)} />
            </label>
            {money(f, "basePriceCents", t("basePrice"), { hint: t("basePriceHint") })}
            {money(f, "depositCents", t("deposit"), { nullable: true })}
            {money(f, "excessCents", t("excess"), { nullable: true })}
            <IntInput label={t("sortOrder")} value={v.sortOrder} onChange={(x) => f.set("sortOrder", x ?? 0)} min={0} />
            <Check label={t("airCondition")} checked={v.airCondition} onChange={(x) => f.set("airCondition", x)} />
            <Check label={t("isPublic")} checked={v.isPublic} onChange={(x) => f.set("isPublic", x)} />
            <Check label={t("isActive")} checked={v.isActive} onChange={(x) => f.set("isActive", x)} />
            <div className="dash-field dash-field--wide">
              <span>{t("photos")}</span>
              {f.saved ? (
                <VehiclePhotos
                  vehicleId={f.saved.id}
                  apiBase={`/api/public-site/group-photos/${f.saved.id}`}
                  photos={v.photos ?? []}
                  canManage
                  onChange={(fn) => f.set("photos", fn(v.photos ?? []))}
                  alt={el(v.name)}
                />
              ) : (
                <span className="dash-form-note">{t("photosAfterSave")}</span>
              )}
            </div>
          </>
        );
      }}
    />
  );
}

/* ─────────────────────────────────────────────
   Τοποθεσίες
   ───────────────────────────────────────────── */

const LOC_TYPES = ["airport", "port", "office", "city", "hotel", "other"] as const;

export interface LocationItem {
  slug: string;
  name: LocalizedText;
  type: (typeof LOC_TYPES)[number];
  address: string | null;
  lat: number | null;
  lng: number | null;
  askFlightNumber: boolean;
  askFerryName: boolean;
  askAddress: boolean;
  adjustmentType: "none" | "percent" | "fixed";
  adjustmentValue: number;
  adjustmentLabel: LocalizedText;
  afterHoursFeeCents: number | null;
  allowPickup: boolean;
  allowDropoff: boolean;
  sortOrder: number;
  isActive: boolean;
}

const coord = (s: string): number | null => {
  const n = Number(s.replace(",", "."));
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};

export function LocationsTab() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const adj = (l: LocationItem) =>
    l.adjustmentType === "percent"
      ? `${l.adjustmentValue > 0 ? "+" : ""}${l.adjustmentValue}%`
      : l.adjustmentType === "fixed"
        ? `${l.adjustmentValue > 0 ? "+" : ""}${formatCents(l.adjustmentValue)}`
        : "";
  return (
    <ResourceList<LocationItem>
      resource="locations"
      intro={t("locationsIntro")}
      empty={() => ({
        slug: "",
        name: {},
        type: "airport",
        address: null,
        lat: null,
        lng: null,
        askFlightNumber: false,
        askFerryName: false,
        askAddress: false,
        adjustmentType: "none",
        adjustmentValue: 0,
        adjustmentLabel: {},
        afterHoursFeeCents: null,
        allowPickup: true,
        allowDropoff: true,
        sortOrder: 0,
        isActive: true,
      })}
      title={(l) => el(l.name)}
      summary={(l) => (
        <>
          {t(`lt_${l.type}`)} · /{l.slug}
          {adj(l) && ` · ${adj(l)}`}
          {!l.isActive && <span className="dash-ps-badge">{t("inactive")}</span>}
        </>
      )}
      renderForm={(f) => {
        const v = f.value;
        return (
          <>
            <I18nInput label={t("name")} value={v.name} onChange={(x) => f.set("name", x)} maxLength={80} required />
            <label className="dash-field">
              {t("slug")} *
              <input value={v.slug} maxLength={60} onChange={(e) => f.set("slug", e.target.value.toLowerCase())} placeholder="chania-airport" />
            </label>
            <Select
              label={t("locType")}
              value={v.type}
              options={LOC_TYPES.map((x) => ({ value: x, label: t(`lt_${x}`) }))}
              onChange={(x) => {
                f.set("type", x);
                if (x === "airport") f.set("askFlightNumber", true);
                if (x === "port") f.set("askFerryName", true);
                if (x === "hotel" || x === "other") f.set("askAddress", true);
              }}
            />
            <label className="dash-field dash-field--wide">
              {t("address")}
              <input value={v.address ?? ""} maxLength={200} onChange={(e) => f.set("address", e.target.value || null)} />
            </label>
            <label className="dash-field">
              {t("lat")}
              <input inputMode="decimal" defaultValue={v.lat ?? ""} onChange={(e) => f.set("lat", coord(e.target.value))} />
            </label>
            <label className="dash-field">
              {t("lng")}
              <input inputMode="decimal" defaultValue={v.lng ?? ""} onChange={(e) => f.set("lng", coord(e.target.value))} />
            </label>
            <Select
              label={t("adjustmentType")}
              value={v.adjustmentType}
              options={(["none", "percent", "fixed"] as const).map((x) => ({ value: x, label: t(`adj_${x}`) }))}
              onChange={(x) => {
                f.set("adjustmentType", x);
                f.set("adjustmentValue", 0);
                f.markInvalid("adjustmentValue", false);
              }}
            />
            {v.adjustmentType === "percent" && (
              <IntInput label={t("adjustmentPercent")} value={v.adjustmentValue} onChange={(x) => f.set("adjustmentValue", x ?? 0)} min={-100} max={100} />
            )}
            {v.adjustmentType === "fixed" && money(f, "adjustmentValue", t("adjustmentFixed"), { allowNegative: true })}
            {v.adjustmentType !== "none" && (
              <I18nInput label={t("adjustmentLabel")} value={v.adjustmentLabel} onChange={(x) => f.set("adjustmentLabel", x)} maxLength={80} />
            )}
            {money(f, "afterHoursFeeCents", t("afterHoursFee"), { nullable: true, hint: t("afterHoursFeeHint") })}
            <IntInput label={t("sortOrder")} value={v.sortOrder} onChange={(x) => f.set("sortOrder", x ?? 0)} min={0} />
            <Check label={t("allowPickup")} checked={v.allowPickup} onChange={(x) => f.set("allowPickup", x)} />
            <Check label={t("allowDropoff")} checked={v.allowDropoff} onChange={(x) => f.set("allowDropoff", x)} />
            <Check label={t("askFlightNumber")} checked={v.askFlightNumber} onChange={(x) => f.set("askFlightNumber", x)} />
            <Check label={t("askFerryName")} checked={v.askFerryName} onChange={(x) => f.set("askFerryName", x)} />
            <Check label={t("askAddress")} checked={v.askAddress} onChange={(x) => f.set("askAddress", x)} />
            <Check label={t("isActive")} checked={v.isActive} onChange={(x) => f.set("isActive", x)} />
          </>
        );
      }}
    />
  );
}

/* ─────────────────────────────────────────────
   Σεζόν
   ───────────────────────────────────────────── */

export interface SeasonItem {
  name: LocalizedText;
  startMonthDay: string;
  endMonthDay: string;
  minDays: number | null;
  priority: number;
  sortOrder: number;
}

export function SeasonsList({ onChange }: { onChange?: () => void }) {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  return (
    <ResourceList<SeasonItem>
      resource="seasons"
      intro={t("seasonsIntro")}
      onItems={onChange}
      empty={() => ({ name: {}, startMonthDay: "06-01", endMonthDay: "06-30", minDays: null, priority: 0, sortOrder: 0 })}
      title={(s) => el(s.name)}
      summary={(s) => (
        <>
          {s.startMonthDay} → {s.endMonthDay}
          {s.minDays ? ` · ${t("minDays")}: ${s.minDays}` : ""} · {t("priority")}: {s.priority}
        </>
      )}
      renderForm={(f) => {
        const v = f.value;
        return (
          <>
            <I18nInput label={t("name")} value={v.name} onChange={(x) => f.set("name", x)} maxLength={60} required />
            <label className="dash-field">
              {t("startMonthDay")}
              <input value={v.startMonthDay} maxLength={5} placeholder="06-01" onChange={(e) => f.set("startMonthDay", e.target.value)} />
            </label>
            <label className="dash-field">
              {t("endMonthDay")}
              <input value={v.endMonthDay} maxLength={5} placeholder="09-30" onChange={(e) => f.set("endMonthDay", e.target.value)} />
            </label>
            <IntInput label={t("minDays")} value={v.minDays} onChange={(x) => f.set("minDays", x)} nullable min={1} max={60} />
            <IntInput label={t("priority")} value={v.priority} onChange={(x) => f.set("priority", x ?? 0)} min={0} max={100} />
            <IntInput label={t("sortOrder")} value={v.sortOrder} onChange={(x) => f.set("sortOrder", x ?? 0)} min={0} />
          </>
        );
      }}
    />
  );
}

/* ─────────────────────────────────────────────
   Ηλικίες οδηγού
   ───────────────────────────────────────────── */

export interface AgeBandItem {
  minAge: number;
  maxAge: number;
  label: LocalizedText;
  explanation: LocalizedText;
  allowed: boolean;
  isDefault: boolean;
  surchargeType: "none" | "per_day" | "per_rental";
  surchargeCents: number;
  surchargeMaxCents: number | null;
  sortOrder: number;
}

export function AgesTab() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  return (
    <ResourceList<AgeBandItem>
      resource="age-bands"
      intro={t("agesIntro")}
      empty={() => ({
        minAge: 23,
        maxAge: 70,
        label: {},
        explanation: {},
        allowed: true,
        isDefault: false,
        surchargeType: "none",
        surchargeCents: 0,
        surchargeMaxCents: null,
        sortOrder: 0,
      })}
      title={(b) => `${b.minAge}–${b.maxAge} · ${el(b.label)}`}
      summary={(b) => (
        <>
          {b.allowed ? t("allowed") : `${t("allowed")}: ${t("no")}`}
          {b.surchargeType !== "none" && ` · ${formatCents(b.surchargeCents)} ${t(b.surchargeType === "per_day" ? "perDayShort" : "perRentalShort")}`}
          {b.isDefault && <span className="dash-ps-badge dash-ps-badge--ok">{t("isDefault")}</span>}
        </>
      )}
      renderForm={(f) => {
        const v = f.value;
        return (
          <>
            <IntInput label={t("minAge")} value={v.minAge} onChange={(x) => f.set("minAge", x ?? 16)} min={16} max={120} />
            <IntInput label={t("maxAge")} value={v.maxAge} onChange={(x) => f.set("maxAge", x ?? 16)} min={16} max={120} />
            <I18nInput label={t("label")} value={v.label} onChange={(x) => f.set("label", x)} maxLength={60} required />
            <I18nInput label={t("explanation")} value={v.explanation} onChange={(x) => f.set("explanation", x)} maxLength={300} multiline />
            <Select
              label={t("surchargeType")}
              value={v.surchargeType}
              options={(["none", "per_day", "per_rental"] as const).map((x) => ({ value: x, label: t(`sur_${x}`) }))}
              onChange={(x) => f.set("surchargeType", x)}
            />
            {v.surchargeType !== "none" && money(f, "surchargeCents", t("surcharge"))}
            {v.surchargeType !== "none" && money(f, "surchargeMaxCents", t("surchargeMax"), { nullable: true, hint: t("maxTotalHint") })}
            <IntInput label={t("sortOrder")} value={v.sortOrder} onChange={(x) => f.set("sortOrder", x ?? 0)} min={0} />
            <Check label={t("allowed")} checked={v.allowed} onChange={(x) => f.set("allowed", x)} />
            <Check label={t("isDefault")} checked={v.isDefault} onChange={(x) => f.set("isDefault", x)} />
          </>
        );
      }}
    />
  );
}
