"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/I18nProvider";

export interface CompanyFields {
  phone: string;
  address: string;
  region: string;
  vat: string;
  taxOffice: string;
  contractTermsEl: string;
  contractTermsEn: string;
}

type Key = keyof CompanyFields;

const COMPANY_KEYS: Key[] = ["region", "address", "vat", "taxOffice", "phone"];
const TERMS_KEYS: Key[] = ["contractTermsEl", "contractTermsEn"];

/**
 * Στοιχεία εταιρίας για την κεφαλίδα του συμβολαίου και οι όροι ενοικίασης
 * σε δύο γλώσσες. Η επωνυμία και το email τα διαχειρίζεται ο Super Admin.
 */
export default function CompanyContractSettings({
  companyName,
  companyEmail,
  initial,
}: {
  companyName: string;
  companyEmail: string;
  initial: CompanyFields;
}) {
  const tr = useT();
  const router = useRouter();

  const [saved, setSaved] = useState<CompanyFields>(initial);
  const [draft, setDraft] = useState<CompanyFields>(initial);
  const [busy, setBusy] = useState<"company" | "terms" | null>(null);
  const [done, setDone] = useState<"company" | "terms" | null>(null);
  const [error, setError] = useState<{ part: string; message: string } | null>(null);

  const set = (k: Key, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDone(null);
  };

  const dirty = (keys: Key[]) => keys.some((k) => draft[k] !== saved[k]);

  const save = async (part: "company" | "terms", keys: Key[]) => {
    if (busy || !dirty(keys)) return;
    setBusy(part);
    setError(null);
    setDone(null);
    try {
      const body = Object.fromEntries(keys.map((k) => [k, draft[k]]));
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ part, message: data.message || tr("settings.errorSave") });
        return;
      }
      const next = { ...saved };
      for (const k of keys) next[k] = (data.data?.[k] as string | null) ?? "";
      setSaved(next);
      setDraft((d) => ({ ...d, ...Object.fromEntries(keys.map((k) => [k, next[k]])) }));
      setDone(part);
      router.refresh();
    } catch {
      setError({ part, message: tr("settings.errorConnection") });
    } finally {
      setBusy(null);
    }
  };

  const field = (k: Key) => (
    <label key={k} className="dash-field">
      {tr(`settings.company_${k}`)}
      <input value={draft[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  return (
    <>
      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">{tr("settings.companyDetails")}</h2>
        <p className="dash-form-note dash-settings-lead">{tr("settings.companyDetailsHelp")}</p>

        <div className="dash-form-grid">
          <label className="dash-field">
            {tr("settings.company_name")}
            <input value={companyName} disabled />
          </label>
          <label className="dash-field">
            {tr("settings.company_email")}
            <input value={companyEmail} disabled />
          </label>
          {COMPANY_KEYS.map(field)}
        </div>
        <p className="dash-form-note">{tr("settings.companyManagedNote")}</p>

        {error?.part === "company" && <div className="dash-form-error">{error.message}</div>}
        <div className="dash-settings-actions">
          <button
            className="dash-btn dash-btn--primary"
            disabled={!dirty(COMPANY_KEYS) || busy !== null}
            onClick={() => save("company", COMPANY_KEYS)}
          >
            {busy === "company" ? tr("settings.saving") : tr("settings.prepTimeSave")}
          </button>
          {done === "company" && <span className="dash-count">{tr("settings.saved")}</span>}
        </div>
      </div>

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">{tr("settings.contractTerms")}</h2>
        <p className="dash-form-note dash-settings-lead">{tr("settings.contractTermsHelp")}</p>

        <label className="dash-field">
          {tr("settings.contractTermsEl")}
          <textarea
            rows={8}
            value={draft.contractTermsEl}
            onChange={(e) => set("contractTermsEl", e.target.value)}
          />
        </label>
        <label className="dash-field">
          {tr("settings.contractTermsEn")}
          <textarea
            rows={8}
            value={draft.contractTermsEn}
            onChange={(e) => set("contractTermsEn", e.target.value)}
          />
        </label>

        {error?.part === "terms" && <div className="dash-form-error">{error.message}</div>}
        <div className="dash-settings-actions">
          <button
            className="dash-btn dash-btn--primary"
            disabled={!dirty(TERMS_KEYS) || busy !== null}
            onClick={() => save("terms", TERMS_KEYS)}
          >
            {busy === "terms" ? tr("settings.saving") : tr("settings.prepTimeSave")}
          </button>
          {done === "terms" && <span className="dash-count">{tr("settings.saved")}</span>}
        </div>
      </div>
    </>
  );
}
