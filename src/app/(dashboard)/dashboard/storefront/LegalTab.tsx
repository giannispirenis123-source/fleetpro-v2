"use client";

// «Η σελίδα μου» → «Νομικά»: όροι ενοικίασης, απόρρητο, cookies (ΕΛ/EN).
// Χωρίς δικό τους κείμενο το site δείχνει το πρότυπο (ένδειξη «Πρότυπο — να
// ελεγχθεί από νομικό»). Κάθε αποθήκευση = νέα έκδοση (PUT /api/public-site/legal).
// Προεπισκόπηση με το ΙΔΙΟ component του site (LegalText, χωρίς raw HTML).

import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import LegalText from "@/components/storefront/LegalText";
import { LEGAL_BODY_MAX, fillPlaceholders, formatLegalDate, type LegalCompany, type LegalKind } from "@/lib/legal/legal";
import { storefrontPath } from "@/lib/storefront/slug";
import { Status, api } from "./ui";

interface Entry {
  kind: LegalKind;
  lang: "el" | "en";
  body: string | null;
  version: number | null;
  updated: string;
  isTemplate: boolean;
}

interface LegalDTO {
  slug: string | null;
  entries: Entry[];
  templates: Record<LegalKind, Record<"el" | "en", string>>;
  templateUpdated: string;
  company: LegalCompany | null;
  missing: string[];
}

const KINDS: { kind: LegalKind; label: string }[] = [
  { kind: "terms", label: "publicSite.legalTerms" },
  { kind: "privacy", label: "publicSite.legalPrivacy" },
  { kind: "cookies", label: "publicSite.legalCookies" },
];

export default function LegalTab() {
  const tr = useT();
  const [data, setData] = useState<LegalDTO | null>(null);
  const [loadError, setLoadError] = useState("");
  const [kind, setKind] = useState<LegalKind>("terms");
  const [lang, setLang] = useState<"el" | "en">("el");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<LegalDTO>("/api/public-site/legal").then((r) => {
      if (r.ok && r.data) setData(r.data);
      else setLoadError(r.message || tr("publicSite.errorLoad"));
    });
  }, [tr]);

  const key = `${kind}/${lang}`;
  const entry = data?.entries.find((e) => e.kind === kind && e.lang === lang) ?? null;
  const original = entry?.body ?? data?.templates[kind][lang] ?? "";
  const text = drafts[key] ?? original;
  const dirty = drafts[key] !== undefined && drafts[key] !== original;
  const preview = useMemo(
    () => (data?.company ? fillPlaceholders(text, data.company) : text),
    [text, data?.company]
  );

  if (loadError) return <div className="dash-form-error">{loadError}</div>;
  if (!data) return <div className="dash-panel dash-settings-panel">…</div>;

  const anyTemplate = data.entries.some((e) => e.isTemplate);

  const save = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    const r = await api<LegalDTO>("/api/public-site/legal", "PUT", { kind, lang, body: text });
    setBusy(false);
    if (!r.ok || !r.data) {
      setError(r.message || tr("publicSite.errorSave"));
      return;
    }
    setData(r.data);
    setDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
    setSaved(true);
  };

  return (
    <div className="dash-panel dash-settings-panel">
      <p className="dash-form-note dash-settings-lead">{tr("publicSite.legalIntro")}</p>
      {anyTemplate && <div className="dash-ps-legal-warn">{tr("publicSite.legalTemplateWarn")}</div>}
      {data.missing.length > 0 && (
        <p className="dash-form-error">
          {tr("publicSite.legalMissing")} {data.missing.map((f) => tr(`publicSite.legalField_${f}`)).join(", ")}
        </p>
      )}

      <nav className="dash-ps-tabs dash-ps-legal-kinds" aria-label={tr("publicSite.tabLegal")}>
        {KINDS.map((k) => {
          const tpl = data.entries.some((e) => e.kind === k.kind && e.isTemplate);
          return (
            <button
              key={k.kind}
              type="button"
              className={`dash-ps-tab ${kind === k.kind ? "active" : ""}`}
              aria-current={kind === k.kind ? "page" : undefined}
              onClick={() => {
                setKind(k.kind);
                setSaved(false);
              }}
            >
              {tr(k.label)}
              {tpl && <span className="dash-ps-legal-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </nav>

      <div className="dash-ps-legal-head">
        <div className="dash-ps-legal-langs" role="group">
          {(["el", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={`dash-btn dash-btn--sm ${lang === l ? "dash-btn--primary" : ""}`}
              aria-pressed={lang === l}
              onClick={() => {
                setLang(l);
                setSaved(false);
              }}
            >
              {tr(`publicSite.${l}`)}
            </button>
          ))}
        </div>
        <span className={`dash-ps-legal-badge ${entry?.isTemplate ? "is-template" : "is-own"}`}>
          {entry?.isTemplate ? tr("publicSite.legalTemplateBadge") : tr("publicSite.legalOwnBadge").replace("{v}", String(entry?.version ?? ""))}
        </span>
        <span className="dash-form-note">
          {tr("publicSite.legalUpdated").replace("{date}", formatLegalDate(entry?.updated ?? data.templateUpdated, "el"))}
        </span>
        {data.slug && (
          <a className="dash-btn dash-btn--sm" href={storefrontPath(data.slug, lang, kind)} target="_blank" rel="noopener">
            <ExternalLink size={14} /> {tr("publicSite.legalOpen")}
          </a>
        )}
      </div>

      <div className="dash-ps-legal-modes" role="group">
        {(["edit", "preview"] as const).map((m) => (
          <button key={m} type="button" className={`dash-ps-tab ${mode === m ? "active" : ""}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
            {tr(m === "edit" ? "publicSite.legalEdit" : "publicSite.legalPreview")}
          </button>
        ))}
      </div>

      {mode === "edit" ? (
        <label className="dash-field dash-field--wide">
          <textarea
            className="dash-ps-legal-text"
            rows={22}
            maxLength={LEGAL_BODY_MAX}
            value={text}
            spellCheck
            lang={lang}
            onChange={(e) => {
              const v = e.target.value;
              setDrafts((d) => ({ ...d, [key]: v }));
              setSaved(false);
            }}
          />
          <span className="dash-form-note">{tr("publicSite.legalHelp")}</span>
        </label>
      ) : (
        <div className="dash-ps-legal-preview" lang={lang}>
          <LegalText body={preview} />
        </div>
      )}

      <div className="dash-sf-actions">
        <Status error={error} saved={saved} />
        {dirty && <span className="dash-form-note">{tr("publicSite.legalUnsaved")}</span>}
        <button
          type="button"
          className="dash-btn"
          onClick={() => {
            setDrafts((d) => ({ ...d, [key]: data.templates[kind][lang] }));
            setSaved(false);
          }}
        >
          {tr("publicSite.legalLoadTemplate")}
        </button>
        <button type="button" className="dash-btn dash-btn--primary" onClick={save} disabled={busy}>
          {busy ? tr("publicSite.legalSaving") : tr("publicSite.legalSave")}
        </button>
      </div>
    </div>
  );
}
