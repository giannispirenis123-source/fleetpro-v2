"use client";

// src/app/(dashboard)/dashboard/storefront/InsuranceLevels.tsx
// «Επίπεδα ασφάλειας» της εταιρίας (καρτέλα «Extras & Ασφάλειες»).
// Ο πελάτης τα βλέπει στη φόρμα κράτησης και διαλέγει ΑΝ θέλει — καμία
// προεπιλογή. Όλα τα ποσά σε cents· η αποθήκευση ελέγχεται στον server.

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { formatCents } from "@/lib/public/money";
import type { LocalizedText } from "@/lib/public/text";
import type { InsuranceLevelDTO } from "@/lib/public/insuranceLevels";
import { Check, ConfirmModal, I18nInput, MoneyInput, Select, api } from "./ui";

type Level = InsuranceLevelDTO;
type Draft = Omit<Level, "id" | "sortOrder"> & { id: string | null };

const EMPTY: Draft = {
  id: null,
  nameI18n: {},
  descriptionI18n: {},
  coveragesI18n: [],
  priceCents: 0,
  chargeType: "PER_DAY",
  maxTotalCents: null,
  excessCents: null,
  vehicleTypes: [],
  isActive: true,
};

const el = (t: LocalizedText) => t.el || t.en || Object.values(t)[0] || "";

export default function InsuranceLevels() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const [items, setItems] = useState<Level[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Level | null>(null);
  const [moneyOk, setMoneyOk] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    api<{ items: Level[] }>("/api/public-site/insurance").then((r) => {
      if (r.ok && r.data) setItems(r.data.items);
      else setError(r.message || t("errorLoad"));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = (r: { ok: boolean; data?: { items: Level[] }; message?: string }) => {
    if (!r.ok || !r.data) {
      setError(r.message || t("errorSave"));
      return false;
    }
    setItems(r.data.items);
    setError("");
    return true;
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    const { id, ...body } = editing;
    const r = id
      ? await api<{ items: Level[] }>(`/api/public-site/insurance/${id}`, "PATCH", body)
      : await api<{ items: Level[] }>("/api/public-site/insurance", "POST", body);
    setBusy(false);
    if (done(r)) {
      setEditing(null);
      setNote(t("insSaved"));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    const r = await api<{ items: Level[]; action: "delete" | "deactivate" }>(`/api/public-site/insurance/${deleting.id}`, "DELETE");
    setBusy(false);
    if (done(r)) setNote(r.data?.action === "deactivate" ? t("insDeactivated") : t("insDeleted"));
    setDeleting(null);
  };

  const move = async (id: string, dir: "up" | "down") => {
    setBusy(true);
    done(await api<{ items: Level[] }>(`/api/public-site/insurance/${id}/move`, "POST", { dir }));
    setBusy(false);
  };

  const price = (x: Pick<Level, "priceCents" | "chargeType">) =>
    `${formatCents(x.priceCents)} ${t(x.chargeType === "PER_DAY" ? "perDayShort" : "perRentalShort")}`;
  const allMoneyOk = Object.values(moneyOk).every(Boolean);

  const setCov = (i: number, v: LocalizedText) =>
    setEditing((e) => (e ? { ...e, coveragesI18n: e.coveragesI18n.map((c, k) => (k === i ? v : c)) } : e));

  return (
    <div className="dash-panel dash-settings-panel">
      <div className="dash-ps-head">
        <div>
          <h2 className="dash-section-title">{t("insTitle")}</h2>
          <p className="dash-form-note dash-settings-lead">{t("insIntro")}</p>
        </div>
        {!editing && (
          <button
            className="dash-btn dash-btn--primary dash-btn--sm"
            onClick={() => {
              setMoneyOk({});
              setNote("");
              setEditing({ ...EMPTY });
            }}
          >
            <Plus size={14} /> {t("insAdd")}
          </button>
        )}
      </div>
      {error && <div className="dash-form-error">{error}</div>}
      {note && !editing && <div className="dash-alert-ok dash-settings-saved">✓ {note}</div>}
      {!items && !error && <p className="dash-form-note">{t("loading")}</p>}

      {editing ? (
        <div className="dash-ps-form">
          <div className="dash-form-grid">
            <I18nInput label={t("name")} value={editing.nameI18n} onChange={(v) => setEditing({ ...editing, nameI18n: v })} maxLength={80} required />
            <I18nInput
              label={t("insShortDescription")}
              value={editing.descriptionI18n}
              onChange={(v) => setEditing({ ...editing, descriptionI18n: v })}
              maxLength={300}
            />
            <div className="dash-field dash-field--wide">
              <span>{t("insCoverages")}</span>
              <span className="dash-form-note">{t("insCoveragesHint")}</span>
              <ul className="dash-ins-covers">
                {editing.coveragesI18n.map((c, i) => (
                  <li key={i} className="dash-ins-cover">
                    <input
                      aria-label={`${t("insCoverages")} ${i + 1} (ΕΛ)`}
                      placeholder="ΕΛ"
                      maxLength={120}
                      value={c.el ?? ""}
                      onChange={(e) => setCov(i, { ...c, el: e.target.value })}
                    />
                    <input
                      aria-label={`${t("insCoverages")} ${i + 1} (EN)`}
                      placeholder="EN"
                      maxLength={120}
                      value={c.en ?? ""}
                      onChange={(e) => setCov(i, { ...c, en: e.target.value })}
                    />
                    <button
                      type="button"
                      className="dash-icon-btn"
                      aria-label={t("insRemoveCoverage")}
                      title={t("insRemoveCoverage")}
                      onClick={() => setEditing({ ...editing, coveragesI18n: editing.coveragesI18n.filter((_, k) => k !== i) })}
                    >
                      <X size={15} />
                    </button>
                  </li>
                ))}
              </ul>
              {editing.coveragesI18n.length < 20 && (
                <button
                  type="button"
                  className="dash-btn dash-btn--sm"
                  onClick={() => setEditing({ ...editing, coveragesI18n: [...editing.coveragesI18n, {}] })}
                >
                  <Plus size={14} /> {t("insAddCoverage")}
                </button>
              )}
            </div>
            <MoneyInput
              label={t("price")}
              cents={editing.priceCents}
              onChange={(c, ok) => {
                setMoneyOk((m) => ({ ...m, price: ok }));
                if (ok && c !== null) setEditing((e) => (e ? { ...e, priceCents: c } : e));
              }}
            />
            <Select
              label={t("insCharge")}
              value={editing.chargeType}
              options={[
                { value: "PER_DAY", label: t("insPerDay") },
                { value: "ONE_OFF", label: t("insPerRental") },
              ]}
              onChange={(v) => setEditing({ ...editing, chargeType: v })}
            />
            <MoneyInput
              label={t("maxTotal")}
              cents={editing.maxTotalCents}
              nullable
              hint={t("maxTotalHint")}
              onChange={(c, ok) => {
                setMoneyOk((m) => ({ ...m, max: ok }));
                if (ok) setEditing((e) => (e ? { ...e, maxTotalCents: c } : e));
              }}
            />
            <MoneyInput
              label={t("insExcess")}
              cents={editing.excessCents}
              nullable
              hint={t("insExcessHint")}
              onChange={(c, ok) => {
                setMoneyOk((m) => ({ ...m, excess: ok }));
                if (ok) setEditing((e) => (e ? { ...e, excessCents: c } : e));
              }}
            />
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
          </div>
          {error && <div className="dash-form-error">{error}</div>}
          <div className="dash-ps-actions">
            <button className="dash-btn" onClick={() => setEditing(null)} disabled={busy}>
              {t("cancel")}
            </button>
            <button className="dash-btn dash-btn--primary" onClick={save} disabled={busy || !allMoneyOk || !editing.nameI18n.el?.trim()}>
              {busy ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      ) : (
        items && (
          <ul className="dash-ps-list">
            {items.length === 0 && <li className="dash-form-note">{t("insEmpty")}</li>}
            {items.map((x, i) => (
              <li key={x.id} className="dash-ps-item">
                <div className="dash-ps-item-main">
                  <strong>{el(x.nameI18n)}</strong>
                  <div className="dash-ps-item-sub">
                    {price(x)}
                    {x.maxTotalCents !== null && ` · ${t("maxTotal")}: ${formatCents(x.maxTotalCents)}`}
                    {x.excessCents !== null && ` · ${t("insExcess")}: ${formatCents(x.excessCents)}`}
                    {x.vehicleTypes.length > 0 && ` · ${x.vehicleTypes.map((vt) => t(`vt_${vt}`)).join(", ")}`}
                    {x.coveragesI18n.length > 0 && ` · ${x.coveragesI18n.length} ${t("insCoveragesCount")}`}
                    {!x.isActive && <span className="dash-ps-badge">{t("inactive")}</span>}
                  </div>
                </div>
                <div className="dash-ps-item-actions">
                  <button className="dash-icon-btn" aria-label={t("moveUp")} title={t("moveUp")} disabled={busy || i === 0} onClick={() => move(x.id, "up")}>
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="dash-icon-btn"
                    aria-label={t("moveDown")}
                    title={t("moveDown")}
                    disabled={busy || i === items.length - 1}
                    onClick={() => move(x.id, "down")}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    className="dash-btn dash-btn--sm"
                    onClick={() => {
                      setMoneyOk({});
                      setNote("");
                      const { sortOrder: _s, ...rest } = x;
                      setEditing(rest);
                    }}
                  >
                    <Pencil size={14} /> <span className="dash-ps-hide-xs">{t("edit")}</span>
                  </button>
                  <button className="dash-icon-btn dash-icon-btn--danger" aria-label={t("delete")} title={t("delete")} onClick={() => setDeleting(x)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {deleting && (
        <ConfirmModal
          title={t("insDeleteTitle")}
          text={`${el(deleting.nameI18n)} — ${t("insDeleteText")}`}
          busy={busy}
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
