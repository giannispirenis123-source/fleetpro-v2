"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import type { StorefrontAdminDTO } from "@/lib/storefront/admin";
import { TEXT_FIELDS, TEXT_MAX, type TextField } from "@/lib/storefront/settings";
import { SLUG_MAX, normalizeSlug, storefrontPath, validateSlug } from "@/lib/storefront/slug";

type SlugState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

const FIELD_LABEL: Record<TextField, string> = {
  title: "storefront.titleField",
  tagline: "storefront.taglineField",
  about: "storefront.aboutField",
};

export default function StorefrontClient({
  initial,
  languages,
}: {
  initial: StorefrontAdminDTO;
  languages: { code: string; name: string }[];
}) {
  const tr = useT();
  const router = useRouter();

  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [slug, setSlug] = useState(initial.slug ?? "");
  const [slugState, setSlugState] = useState<SlugState>({ kind: "idle" });
  const [texts, setTexts] = useState(() => ({
    title: { ...initial.settings.title },
    tagline: { ...initial.settings.tagline },
    about: { ...initial.settings.about },
  }));
  const [langs, setLangs] = useState<string[]>(initial.settings.supportedLanguages);
  const [defaultLang, setDefaultLang] = useState(initial.settings.defaultLanguage);
  const [payOnPickup, setPayOnPickup] = useState(initial.settings.paymentOptions.onPickup);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Έλεγχος διαθεσιμότητας με μικρή καθυστέρηση. Τελική κρίση: ο server στο PATCH.
  useEffect(() => {
    const value = normalizeSlug(slug);
    if (!value || value === saved.slug) {
      setSlugState({ kind: "idle" });
      return;
    }
    const local = validateSlug(value);
    if (!local.ok) {
      setSlugState({ kind: "error", message: local.message });
      return;
    }
    setSlugState({ kind: "checking" });
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/storefront/slug?slug=${encodeURIComponent(value)}`, {
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (!res.ok) setSlugState({ kind: "error", message: data.message || tr("storefront.errorSave") });
        else if (data.data.available) setSlugState({ kind: "ok" });
        else setSlugState({ kind: "error", message: data.data.message });
      } catch {
        if (!ctrl.signal.aborted) setSlugState({ kind: "idle" });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [slug, saved.slug, tr]);

  const toggleLang = (code: string, on: boolean) => {
    setLangs((prev) => {
      const next = on ? [...prev, code] : prev.filter((c) => c !== code);
      if (next.length === 0) return prev; // τουλάχιστον μία
      if (!next.includes(defaultLang)) setDefaultLang(next[0]);
      return languages.map((l) => l.code).filter((c) => next.includes(c));
    });
  };

  const setText = (field: TextField, lang: string, value: string) =>
    setTexts((prev) => ({ ...prev, [field]: { ...prev[field], [lang]: value } }));

  const save = async () => {
    setSaving(true);
    setError("");
    setDone(false);
    try {
      const res = await fetch("/api/storefront", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          slug: normalizeSlug(slug),
          ...texts,
          supportedLanguages: langs,
          defaultLanguage: defaultLang,
          payOnPickup,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || tr("storefront.errorSave"));
        return;
      }
      setSaved(data.data);
      setSlug(data.data.slug ?? "");
      setEnabled(data.data.enabled);
      setDone(true);
      router.refresh();
    } catch {
      setError(tr("storefront.errorConnection"));
    } finally {
      setSaving(false);
    }
  };

  const previewHref = saved.slug
    ? storefrontPath(saved.slug, saved.settings.defaultLanguage, saved.settings.defaultLanguage)
    : null;

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{tr("storefront.title")}</h1>
        <p className="dash-page-sub">{tr("storefront.subtitle")}</p>
      </div>

      <div className="dash-panel dash-settings-panel">
        <label className="dash-switch">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="dash-switch-text">
            <span className="dash-switch-name">{tr("storefront.enabled")}</span>
            <span className="dash-switch-desc">{tr("storefront.enabledHint")}</span>
          </span>
        </label>

        <div className="dash-form-grid" style={{ marginTop: 16 }}>
          <label className="dash-field dash-field--wide">
            {tr("storefront.slug")}
            <div className="dash-sf-slug">
              <span className="dash-sf-prefix">/s/</span>
              <input
                value={slug}
                maxLength={SLUG_MAX}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="my-company"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <span className="dash-form-note">
              {slugState.kind === "checking" && tr("storefront.slugChecking")}
              {slugState.kind === "ok" && (
                <span className="dash-sf-ok">
                  <Check size={13} /> {tr("storefront.slugAvailable")}
                </span>
              )}
              {slugState.kind === "error" && <span className="dash-sf-err">{slugState.message}</span>}
              {slugState.kind === "idle" && tr("storefront.slugHint")}
            </span>
          </label>
        </div>

        <div className="dash-sf-preview">
          {previewHref ? (
            <>
              <a href={previewHref} target="_blank" rel="noopener" className="dash-btn">
                <ExternalLink size={15} /> {tr("storefront.preview")}
              </a>
              <code>{previewHref}</code>
              {!saved.enabled && <p className="dash-form-note">{tr("storefront.previewDisabled")}</p>}
            </>
          ) : (
            <p className="dash-form-note">{tr("storefront.previewNeedsSlug")}</p>
          )}
        </div>
      </div>

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">{tr("storefront.languages")}</h2>
        <p className="dash-form-note dash-settings-lead">{tr("storefront.languagesHint")}</p>
        <div className="dash-sf-langs">
          {languages.map((l) => (
            <label key={l.code} className="dash-field dash-field--check">
              <input
                type="checkbox"
                checked={langs.includes(l.code)}
                onChange={(e) => toggleLang(l.code, e.target.checked)}
              />
              {l.name}
            </label>
          ))}
          <label className="dash-field">
            {tr("storefront.defaultLanguage")}
            <select value={defaultLang} onChange={(e) => setDefaultLang(e.target.value)}>
              {languages
                .filter((l) => langs.includes(l.code))
                .map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">{tr("storefront.texts")}</h2>
        {languages
          .filter((l) => langs.includes(l.code))
          .map((l) => (
            <fieldset key={l.code} className="dash-sf-lang-block">
              <legend>{l.name}</legend>
              <div className="dash-form-grid">
                {TEXT_FIELDS.map((field) => (
                  <label key={field} className="dash-field dash-field--wide">
                    {tr(FIELD_LABEL[field])}
                    {field === "about" ? (
                      <textarea
                        rows={4}
                        maxLength={TEXT_MAX[field]}
                        value={texts[field][l.code] ?? ""}
                        onChange={(e) => setText(field, l.code, e.target.value)}
                      />
                    ) : (
                      <input
                        maxLength={TEXT_MAX[field]}
                        value={texts[field][l.code] ?? ""}
                        onChange={(e) => setText(field, l.code, e.target.value)}
                      />
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
      </div>

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">{tr("storefront.payments")}</h2>
        <label className="dash-field dash-field--check">
          <input type="checkbox" checked={payOnPickup} onChange={(e) => setPayOnPickup(e.target.checked)} />
          {tr("storefront.payOnPickup")}
        </label>
        <label className="dash-field dash-field--check dash-sf-disabled">
          <input type="checkbox" checked={false} disabled />
          {tr("storefront.payOnline")} <span className="dash-soon">{tr("storefront.soon")}</span>
        </label>
        <p className="dash-form-note">{tr("storefront.bookingMode")}</p>
        <p className="dash-form-note">{tr("storefront.vehiclesHint")}</p>
      </div>

      <div className="dash-sf-actions">
        {error && <div className="dash-form-error">{error}</div>}
        {done && !error && (
          <div className="dash-alert-ok dash-settings-saved">
            <Check size={16} /> {tr("storefront.saved")}
          </div>
        )}
        <button
          className="dash-btn dash-btn--primary"
          onClick={save}
          disabled={saving || slugState.kind === "error" || slugState.kind === "checking"}
        >
          {saving ? tr("storefront.saving") : tr("storefront.save")}
        </button>
      </div>
    </>
  );
}
