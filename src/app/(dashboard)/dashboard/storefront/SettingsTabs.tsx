"use client";

// Καρτέλες: Extras & Ασφάλειες · Κρατήσεις & Επικοινωνία · Εμφάνιση · Ενότητες εμπιστοσύνης.
// Οι τρεις τελευταίες γράφουν στο storefrontSettings (PATCH /api/public-site/settings)·
// ο τρόπος κράτησης στο tenants.rentalMode (ΙΔΙΟ πεδίο με τις Ρυθμίσεις).

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Award, Baby, Ban, BadgeEuro, Bike, CarFront, ChevronDown, ChevronUp, Clock, CreditCard, Fuel,
  Headphones, Heart, KeyRound, Lock, MapPin, MoonStar, Navigation, Pencil, Phone, Plane, Plus,
  ShieldCheck, Ship, Sparkles, Star, Sun, ThumbsUp, Trash2, Umbrella, UserPlus, Wallet,
} from "lucide-react";
import VehiclePhotos from "@/components/photos/VehiclePhotos";
import { useT } from "@/lib/i18n/I18nProvider";
import { formatCents } from "@/lib/public/money";
import type { BookingSettings, ContactSettings, ThemeSettings, TrustBlock } from "@/lib/public/siteSettings";
import { MAX_TRUST_BLOCKS, TIMEZONES, TRUST_ICONS } from "@/lib/public/siteSettings";
import type { LocalizedText } from "@/lib/public/text";
import { Check, ConfirmModal, I18nInput, IntInput, MoneyInput, Select, Status, api } from "./ui";

const el = (t: LocalizedText) => t.el || t.en || "";

/* ─────────────────────────────────────────────
   Ρυθμίσεις (κοινό φόρτωμα)
   ───────────────────────────────────────────── */

export interface SiteSettingsDTO {
  rentalMode: "BOOKING" | "REQUEST";
  vatRate: number;
  brandColor: string;
  logoUrl: string | null;
  payOnPickup: boolean;
  booking: BookingSettings;
  contact: ContactSettings;
  theme: ThemeSettings;
  trustBlocks: TrustBlock[];
}

function useSiteSettings() {
  const tr = useT();
  const [data, setData] = useState<SiteSettingsDTO | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<SiteSettingsDTO>("/api/public-site/settings").then((r) => {
      if (r.ok && r.data) setData(r.data);
      else setError(r.message || tr("publicSite.errorLoad"));
    });
  }, [tr]);
  return { data, setData, error };
}

function useSaver(onSaved: (d: SiteSettingsDTO) => void) {
  const tr = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const save = async (body: unknown) => {
    setBusy(true);
    setError("");
    setSaved(false);
    const r = await api<SiteSettingsDTO>("/api/public-site/settings", "PATCH", body);
    setBusy(false);
    if (!r.ok || !r.data) {
      setError(r.message || (r.status ? tr("publicSite.errorSave") : tr("publicSite.errorConnection")));
      return;
    }
    setSaved(true);
    onSaved(r.data);
  };
  return { busy, error, saved, save, dirty: () => setSaved(false) };
}

/* ─────────────────────────────────────────────
   Extras & Ασφάλειες (υπάρχων πίνακας extras)
   ───────────────────────────────────────────── */

interface ExtraItem {
  id: string;
  type: "EXTRA" | "INSURANCE";
  chargeType: "PER_DAY" | "ONE_OFF";
  priceCents: number;
  excessCents: number | null;
  nameI18n: LocalizedText;
  descriptionI18n: LocalizedText;
  maxTotalCents: number | null;
  maxQuantity: number;
  vehicleTypes: string[];
  sortOrder: number;
  isActive: boolean;
  /** Μόνο ασφάλειες: η προεπιλεγμένη για τους τύπους οχημάτων της. */
  isDefault: boolean;
}

export function ExtrasTab() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const [items, setItems] = useState<ExtraItem[] | null>(null);
  const [editing, setEditing] = useState<ExtraItem | null>(null);
  const [moneyOk, setMoneyOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ items: ExtraItem[] }>("/api/public-site/extras").then((r) => {
      if (r.ok && r.data) setItems(r.data.items);
      else setError(r.message || t("errorLoad"));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError("");
    const r = await api<{ item: ExtraItem; items: ExtraItem[] }>(`/api/public-site/extras/${editing.id}`, "PATCH", editing);
    setBusy(false);
    if (!r.ok || !r.data) {
      setError(r.message || t("errorSave"));
      return;
    }
    // Όλη η λίστα: μια νέα προεπιλογή μπορεί να «έσβησε» την προηγούμενη.
    setItems(r.data.items);
    setEditing(null);
  };

  const price = (x: ExtraItem) => `${formatCents(x.priceCents)} ${t(x.chargeType === "PER_DAY" ? "perDayShort" : "perRentalShort")}`;

  return (
    <div className="dash-panel dash-settings-panel">
      <div className="dash-ps-head">
        <p className="dash-form-note dash-settings-lead">{t("extrasIntro")}</p>
        <Link href="/dashboard/extras" className="dash-btn dash-btn--sm">
          {t("extrasPage")}
        </Link>
      </div>
      {error && <div className="dash-form-error">{error}</div>}
      {!items && !error && <p className="dash-form-note">{t("loading")}</p>}
      {editing ? (
        <div className="dash-ps-form">
          <p className="dash-form-note">
            {t(`kind_${editing.type}`)} · {t("price")}: <strong>{price(editing)}</strong>
          </p>
          <div className="dash-form-grid">
            <I18nInput label={t("name")} value={editing.nameI18n} onChange={(v) => setEditing({ ...editing, nameI18n: v })} maxLength={80} required />
            <I18nInput
              label={t("description")}
              value={editing.descriptionI18n}
              onChange={(v) => setEditing({ ...editing, descriptionI18n: v })}
              maxLength={300}
              multiline
            />
            <MoneyInput
              label={t("maxTotal")}
              cents={editing.maxTotalCents}
              nullable
              hint={t("maxTotalHint")}
              onChange={(c, ok) => {
                setMoneyOk(ok);
                if (ok) setEditing((e) => (e ? { ...e, maxTotalCents: c } : e));
              }}
            />
            <IntInput label={t("maxQuantity")} value={editing.maxQuantity} onChange={(v) => setEditing({ ...editing, maxQuantity: v ?? 1 })} min={1} max={10} />
            <IntInput label={t("sortOrder")} value={editing.sortOrder} onChange={(v) => setEditing({ ...editing, sortOrder: v ?? 0 })} min={0} />
            <div className="dash-field dash-field--wide">
              <span>{t("vehicleTypes")}</span>
              <div className="dash-ps-row">
                {(["car", "moto", "atv"] as const).map((vt) => (
                  <Check
                    key={vt}
                    label={t(`vt_${vt}`)}
                    checked={editing.vehicleTypes.includes(vt)}
                    onChange={(on) =>
                      setEditing({
                        ...editing,
                        vehicleTypes: on ? [...editing.vehicleTypes, vt] : editing.vehicleTypes.filter((x) => x !== vt),
                      })
                    }
                  />
                ))}
              </div>
              <span className="dash-form-note">{t("vehicleTypesHint")}</span>
            </div>
            <Check label={t("isActive")} checked={editing.isActive} onChange={(v) => setEditing({ ...editing, isActive: v })} />
            {editing.type === "INSURANCE" && (
              <div className="dash-field dash-field--wide dash-ps-left">
                <Check label={t("isDefault")} checked={editing.isDefault} onChange={(v) => setEditing({ ...editing, isDefault: v })} />
                <span className="dash-form-note">{t("insuranceDefaultHint")}</span>
              </div>
            )}
          </div>
          <div className="dash-ps-actions">
            <button className="dash-btn" onClick={() => setEditing(null)} disabled={busy}>
              {t("cancel")}
            </button>
            <button className="dash-btn dash-btn--primary" onClick={save} disabled={busy || !moneyOk}>
              {busy ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      ) : (
        items && (
          <ul className="dash-ps-list">
            {items.length === 0 && <li className="dash-form-note">{t("empty")}</li>}
            {items.map((x) => (
              <li key={x.id} className="dash-ps-item">
                <div className="dash-ps-item-main">
                  <strong>{el(x.nameI18n)}</strong>
                  <div className="dash-ps-item-sub">
                    {t(`kind_${x.type}`)} · {price(x)}
                    {x.maxTotalCents !== null && ` · ${t("maxTotal")}: ${formatCents(x.maxTotalCents)}`}
                    {x.vehicleTypes.length > 0 && ` · ${x.vehicleTypes.map((vt) => t(`vt_${vt}`)).join(", ")}`}
                    {x.type === "INSURANCE" && x.isDefault && <span className="dash-ps-badge dash-ps-badge--ok">{t("isDefault")}</span>}
                    {!x.isActive && <span className="dash-ps-badge">{t("inactive")}</span>}
                  </div>
                </div>
                <div className="dash-ps-item-actions">
                  <button className="dash-btn dash-btn--sm" onClick={() => { setMoneyOk(true); setEditing(x); }}>
                    <Pencil size={14} /> <span className="dash-ps-hide-xs">{t("edit")}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Κρατήσεις & Επικοινωνία
   ───────────────────────────────────────────── */

export function BookingTab() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const { data, setData, error: loadError } = useSiteSettings();
  const saver = useSaver(setData);
  const [draft, setDraft] = useState<SiteSettingsDTO | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  if (!draft) return <div className="dash-panel dash-settings-panel">{loadError ? <div className="dash-form-error">{loadError}</div> : t("loading")}</div>;
  const b = draft.booking;
  const setB = <K extends keyof BookingSettings>(k: K, v: BookingSettings[K]) => {
    saver.dirty();
    setDraft({ ...draft, booking: { ...b, [k]: v } });
  };
  const setC = (k: keyof ContactSettings, v: string) => {
    saver.dirty();
    setDraft({ ...draft, contact: { ...draft.contact, [k]: v } });
  };
  const mark = (key: string, ok: boolean) =>
    setInvalid((prev) => {
      const next = new Set(prev);
      if (ok) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">{t("bookingMode")}</h2>
        <div className="dash-ps-modes">
          {(["REQUEST", "BOOKING"] as const).map((m) => (
            <label key={m} className={`dash-ps-mode ${draft.rentalMode === m ? "active" : ""}`}>
              <input
                type="radio"
                name="rentalMode"
                checked={draft.rentalMode === m}
                onChange={() => {
                  saver.dirty();
                  setDraft({ ...draft, rentalMode: m });
                }}
              />
              <span>
                <strong>{t(`mode_${m}`)}</strong>
                <span className="dash-form-note">{t(`mode_${m}_help`)}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="dash-form-note">{t("modeShared")}</p>
        <div className="dash-form-grid">
          {draft.rentalMode === "REQUEST" && (
            <IntInput label={t("holdHours")} value={b.holdHours} onChange={(v) => setB("holdHours", v ?? 24)} min={1} max={168} />
          )}
          <IntInput label={t("minLeadHours")} value={b.minLeadHours} onChange={(v) => setB("minLeadHours", v ?? 0)} min={0} max={720} />
          <IntInput label={t("maxAdvanceDays")} value={b.maxAdvanceDays} onChange={(v) => setB("maxAdvanceDays", v ?? 365)} min={1} max={730} />
          <IntInput label={t("graceMinutes")} value={b.graceMinutes} onChange={(v) => setB("graceMinutes", v ?? 0)} min={0} max={240} />
          <label className="dash-field">
            {t("defaultPickupTime")}
            <input type="time" value={b.defaultPickupTime} onChange={(e) => setB("defaultPickupTime", e.target.value)} />
          </label>
          <label className="dash-field">
            {t("defaultDropoffTime")}
            <input type="time" value={b.defaultDropoffTime} onChange={(e) => setB("defaultDropoffTime", e.target.value)} />
          </label>
          <IntInput label={t("defaultRentalDays")} value={b.defaultRentalDays} onChange={(v) => setB("defaultRentalDays", v ?? 3)} min={1} max={60} />
          <Select
            label={t("timezone")}
            value={b.timezone}
            options={TIMEZONES.map((z) => ({ value: z, label: z }))}
            onChange={(v) => setB("timezone", v)}
          />
          <label className="dash-field">
            {t("afterHours")}: {t("afterHoursStart")}
            <input type="time" value={b.afterHours.start} onChange={(e) => setB("afterHours", { ...b.afterHours, start: e.target.value })} />
          </label>
          <label className="dash-field">
            {t("afterHoursEnd")}
            <input type="time" value={b.afterHours.end} onChange={(e) => setB("afterHours", { ...b.afterHours, end: e.target.value })} />
          </label>
          <MoneyInput
            label={t("afterHoursFeeDefault")}
            cents={b.afterHours.feeCents}
            onChange={(c, ok) => {
              mark("ah", ok);
              if (ok) setB("afterHours", { ...b.afterHours, feeCents: c ?? 0 });
            }}
          />
          <MoneyInput
            label={t("oneWayFee")}
            cents={b.oneWayFeeCents}
            nullable
            hint={t("oneWayFeeHint")}
            onChange={(c, ok) => {
              mark("ow", ok);
              if (ok) setB("oneWayFeeCents", c);
            }}
          />
          <Check label={t("noDepositRequired")} checked={b.noDepositRequired} onChange={(v) => setB("noDepositRequired", v)} />
        </div>
      </div>

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">{t("payments")}</h2>
        <Check
          label={t("payOnPickup")}
          checked={draft.payOnPickup}
          onChange={(v) => {
            saver.dirty();
            setDraft({ ...draft, payOnPickup: v });
          }}
        />
        <label className="dash-field dash-field--check dash-sf-disabled">
          <input type="checkbox" checked={false} disabled /> {t("payOnline")}{" "}
          <span className="dash-soon">
            <Lock size={11} /> {t("soon")}
          </span>
        </label>
        <p className="dash-form-note">
          {t("vat")}: <strong>{draft.vatRate}%</strong> — {t("vatHint")}{" "}
          <Link href="/dashboard/settings">{t("openSettings")}</Link>
        </p>
      </div>

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">{t("contact")}</h2>
        <div className="dash-form-grid">
          {(["phone", "whatsapp", "viber", "email", "address", "mapUrl"] as const).map((k) => (
            <label key={k} className={`dash-field ${k === "address" || k === "mapUrl" ? "dash-field--wide" : ""}`}>
              {t(k)}
              <input
                value={draft.contact[k]}
                inputMode={k === "email" ? "email" : k === "mapUrl" ? "url" : k === "address" ? "text" : "tel"}
                onChange={(e) => setC(k, e.target.value)}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="dash-sf-actions">
        <Status error={saver.error} saved={saver.saved} />
        <button
          className="dash-btn dash-btn--primary"
          disabled={saver.busy || invalid.size > 0}
          onClick={() =>
            saver.save({ rentalMode: draft.rentalMode, payOnPickup: draft.payOnPickup, booking: draft.booking, contact: draft.contact })
          }
        >
          {saver.busy ? t("saving") : t("save")}
        </button>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────
   Εμφάνιση
   ───────────────────────────────────────────── */

/** Η συμπιεσμένη εικόνα (≈1600px) πρέπει να είναι οριζόντια και ≥ 1600px. */
async function heroProblem(blob: Blob, message: string): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const ok = bmp.width >= 1600 && bmp.width > bmp.height;
    bmp.close();
    return ok ? null : message;
  } catch {
    return null; // ο server ξαναελέγχει
  }
}

export function AppearanceTab() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const { data, setData, error: loadError } = useSiteSettings();
  const saver = useSaver(setData);
  const [theme, setTheme] = useState<ThemeSettings | null>(null);
  useEffect(() => {
    if (data) setTheme(data.theme);
  }, [data]);

  if (!data || !theme) return <div className="dash-panel dash-settings-panel">{loadError ? <div className="dash-form-error">{loadError}</div> : t("loading")}</div>;
  const set = <K extends keyof ThemeSettings>(k: K, v: ThemeSettings[K]) => {
    saver.dirty();
    setTheme({ ...theme, [k]: v });
  };
  const hero = theme.heroImage ? [{ id: "hero", url: theme.heroImage.url }] : [];
  const accent = theme.accentColor ?? data.brandColor;
  const radius = theme.cornerStyle === "pill" ? "999px" : "12px";

  return (
    <>
      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">{t("hero")}</h2>
        <p className="dash-form-note dash-settings-lead">{t("heroHint")}</p>
        <VehiclePhotos
          vehicleId="hero"
          apiBase="/api/public-site/hero"
          max={1}
          photos={hero}
          canManage
          alt={t("hero")}
          validate={(blob) => heroProblem(blob, t("heroTooSmall"))}
          onChange={(fn) => {
            const next = fn(hero);
            setTheme((th) => (th ? { ...th, heroImage: next[0] ? { url: next[0].url } : null } : th));
          }}
        />
      </div>

      <div className="dash-panel dash-settings-panel">
        <div className="dash-form-grid">
          <I18nInput label={t("heroTitle")} value={theme.heroTitle} onChange={(v) => set("heroTitle", v)} maxLength={120} />
          <I18nInput label={t("heroSubtitle")} value={theme.heroSubtitle} onChange={(v) => set("heroSubtitle", v)} maxLength={240} />
          <div className="dash-field">
            <span>{t("accentColor")}</span>
            <div className="dash-ps-row">
              <input
                type="color"
                value={theme.accentColor ?? data.brandColor}
                onChange={(e) => set("accentColor", e.target.value)}
                className="dash-ps-color"
              />
              <Check label={t("noAccent")} checked={theme.accentColor === null} onChange={(on) => set("accentColor", on ? null : data.brandColor)} />
            </div>
          </div>
          <Select
            label={t("cornerStyle")}
            value={theme.cornerStyle}
            options={(["pill", "rounded"] as const).map((c) => ({ value: c, label: t(`corner_${c}`) }))}
            onChange={(v) => set("cornerStyle", v)}
          />
        </div>
        <p className="dash-form-note">
          {t("brandFrom")} <Link href="/dashboard/settings">{t("openSettings")}</Link>
        </p>
        <div className="dash-ps-brand">
          <span className="dash-ps-swatch" style={{ background: data.brandColor }} /> {t("mainColor")} {data.brandColor}
          <span className="dash-ps-sep">·</span>
          {data.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.logoUrl} alt={t("logo")} className="dash-ps-logo" />
          ) : (
            t("noLogo")
          )}
        </div>

        <h3 className="dash-ps-subtitle">{t("preview")}</h3>
        <div
          className="dash-ps-preview"
          style={{
            backgroundImage: theme.heroImage ? `linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)), url("${theme.heroImage.url}")` : undefined,
            backgroundColor: data.brandColor,
          }}
        >
          <strong>{el(theme.heroTitle) || "Rent a car"}</strong>
          <span>{el(theme.heroSubtitle)}</span>
          <span className="dash-ps-preview-btns">
            <span style={{ background: data.brandColor, borderRadius: radius }}>{t("previewBook")}</span>
            <span style={{ background: accent, borderRadius: radius }}>{t("phone")}</span>
          </span>
        </div>
      </div>

      <div className="dash-sf-actions">
        <Status error={saver.error} saved={saver.saved} />
        <button
          className="dash-btn dash-btn--primary"
          disabled={saver.busy}
          onClick={() =>
            saver.save({
              theme: {
                accentColor: theme.accentColor,
                heroTitle: theme.heroTitle,
                heroSubtitle: theme.heroSubtitle,
                cornerStyle: theme.cornerStyle,
              },
            })
          }
        >
          {saver.busy ? t("saving") : t("save")}
        </button>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────
   Ενότητες εμπιστοσύνης
   ───────────────────────────────────────────── */

const ICONS: Record<string, React.ComponentType<{ size?: string | number }>> = {
  ShieldCheck, BadgeEuro, Wallet, CreditCard, Ban, Plane, Ship, MapPin, Navigation, Clock, MoonStar, Sun,
  CarFront, Bike, KeyRound, Fuel, Headphones, Phone, ThumbsUp, Star, Award, Sparkles, Heart, Umbrella, Baby, UserPlus,
};

export function TrustTab() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const { data, setData, error: loadError } = useSiteSettings();
  const saver = useSaver(setData);
  const [blocks, setBlocks] = useState<TrustBlock[] | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  useEffect(() => {
    if (data) setBlocks(data.trustBlocks);
  }, [data]);

  if (!blocks) return <div className="dash-panel dash-settings-panel">{loadError ? <div className="dash-form-error">{loadError}</div> : t("loading")}</div>;
  const update = (i: number, b: TrustBlock) => {
    saver.dirty();
    setBlocks(blocks.map((x, j) => (j === i ? b : x)));
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = blocks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    saver.dirty();
    setBlocks(next);
  };

  return (
    <>
      <div className="dash-panel dash-settings-panel">
        <div className="dash-ps-head">
          <p className="dash-form-note dash-settings-lead">{t("trustIntro")}</p>
          <button
            className="dash-btn dash-btn--primary"
            disabled={blocks.length >= MAX_TRUST_BLOCKS}
            title={blocks.length >= MAX_TRUST_BLOCKS ? t("maxTrust") : undefined}
            onClick={() => {
              saver.dirty();
              setBlocks([...blocks, { icon: "ShieldCheck", title: {}, text: {} }]);
            }}
          >
            <Plus size={16} /> {t("addTrust")}
          </button>
        </div>
        {blocks.length === 0 && <p className="dash-form-note">{t("empty")}</p>}
        {blocks.map((b, i) => {
          const Icon = ICONS[b.icon] ?? ShieldCheck;
          return (
            <fieldset key={i} className="dash-sf-lang-block">
              <legend>
                <Icon size={15} /> {el(b.title) || `#${i + 1}`}
              </legend>
              <div className="dash-form-grid">
                <label className="dash-field">
                  {t("icon")}
                  <select value={b.icon} onChange={(e) => update(i, { ...b, icon: e.target.value })}>
                    {TRUST_ICONS.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <I18nInput label={t("title")} value={b.title} onChange={(v) => update(i, { ...b, title: v })} maxLength={80} required />
                <I18nInput label={t("text")} value={b.text} onChange={(v) => update(i, { ...b, text: v })} maxLength={300} multiline />
              </div>
              <div className="dash-ps-actions">
                <button className="dash-btn dash-btn--sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("up")}>
                  <ChevronUp size={14} /> {t("up")}
                </button>
                <button className="dash-btn dash-btn--sm" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label={t("down")}>
                  <ChevronDown size={14} /> {t("down")}
                </button>
                <button
                  className="dash-btn dash-btn--sm"
                  onClick={() => setRemoving(i)}
                  aria-label={t("delete")}
                >
                  <Trash2 size={14} /> {t("delete")}
                </button>
              </div>
            </fieldset>
          );
        })}
      </div>
      {removing !== null && (
        <ConfirmModal
          title={`${t("confirmDelete")} ${el(blocks[removing]?.title ?? {})}`}
          text={t("confirmDeleteText")}
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            saver.dirty();
            setBlocks(blocks.filter((_, j) => j !== removing));
            setRemoving(null);
          }}
        />
      )}
      <div className="dash-sf-actions">
        <Status error={saver.error} saved={saver.saved} />
        <button className="dash-btn dash-btn--primary" disabled={saver.busy} onClick={() => saver.save({ trustBlocks: blocks })}>
          {saver.busy ? t("saving") : t("save")}
        </button>
      </div>
    </>
  );
}
