"use client";

// src/app/(dashboard)/dashboard/onboarding/OnboardingClient.tsx
// Η λίστα του onboarding. Κάθε βήμα χρησιμοποιεί τα ΥΠΑΡΧΟΝΤΑ endpoints και
// φόρμες (Ρυθμίσεις, «Η σελίδα μου», φόρμα οχήματος του Στόλου, Stripe Connect,
// Domain)· το /api/onboarding κρατά μόνο το Α και τις παραλείψεις.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleDashed, ExternalLink, SkipForward } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import type { OnboardingDTO } from "@/lib/signup/onboardingServer";
import type { OnboardingStep } from "@/lib/signup/onboarding";
import { SLUG_MAX, normalizeSlug, storefrontPath, validateSlug } from "@/lib/storefront/slug";
import { VehicleModal, type VehicleGroupOption } from "../fleet/FleetClient";

type SlugState = { kind: "idle" } | { kind: "checking" } | { kind: "ok" } | { kind: "error"; message: string };

async function call<T>(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data?: T; message?: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, data: json.data, message: json.message };
  } catch {
    return { ok: false };
  }
}

const TITLES: Record<OnboardingStep, [string, string]> = {
  company: ["companyTitle", "companyText"],
  vehicle: ["vehicleTitle", "vehicleText"],
  payments: ["paymentsTitle", "paymentsText"],
  publish: ["publishTitle", "publishText"],
  domain: ["domainTitle", "domainText"],
};

export default function OnboardingClient({
  initial,
  languages,
  publicSite,
  groups,
}: {
  initial: OnboardingDTO;
  languages: { code: string; name: string }[];
  publicSite: boolean;
  groups: VehicleGroupOption[];
}) {
  const tr = useT();
  const t = (k: string) => tr(`onboarding.${k}`);
  const router = useRouter();
  const [dto, setDto] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [vehicleOpen, setVehicleOpen] = useState(false);

  // Βήμα Α
  const [phone, setPhone] = useState(initial.company.phone);
  const [address, setAddress] = useState(initial.company.address);
  const [langs, setLangs] = useState(initial.storefront.supportedLanguages);
  const [defaultLang, setDefaultLang] = useState(initial.storefront.defaultLanguage);
  const [slug, setSlug] = useState(initial.storefront.slug ?? "");
  const [slugState, setSlugState] = useState<SlugState>({ kind: "idle" });

  const reload = async () => {
    const r = await call<OnboardingDTO>("/api/onboarding", "GET");
    if (r.ok && r.data) setDto(r.data);
    router.refresh();
  };

  // Έλεγχος διαθεσιμότητας slug — το ΙΔΙΟ endpoint με «Η σελίδα μου».
  useEffect(() => {
    const value = normalizeSlug(slug);
    if (!value || value === dto.storefront.slug) return setSlugState({ kind: "idle" });
    const local = validateSlug(value);
    if (!local.ok) return setSlugState({ kind: "error", message: local.message });
    setSlugState({ kind: "checking" });
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/storefront/slug?slug=${encodeURIComponent(value)}`, { signal: ctrl.signal });
        const data = await res.json();
        if (!res.ok) setSlugState({ kind: "error", message: data.message || t("error") });
        else setSlugState(data.data.available ? { kind: "ok" } : { kind: "error", message: data.data.message });
      } catch {
        if (!ctrl.signal.aborted) setSlugState({ kind: "idle" });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, dto.storefront.slug]);

  const run = async (key: string, fn: () => Promise<string | null>) => {
    setBusy(key);
    setError("");
    const msg = await fn();
    if (msg) setError(msg);
    setBusy("");
  };

  const mark = (step: OnboardingStep, action: "done" | "skip" | "unskip") =>
    run(`${step}-${action}`, async () => {
      const r = await call<OnboardingDTO>("/api/onboarding", "PATCH", { step, action });
      if (!r.ok) return r.message ?? t("error");
      if (r.data) setDto(r.data);
      router.refresh();
      return null;
    });

  const saveCompany = () =>
    run("company-save", async () => {
      const a = await call("/api/settings", "PATCH", { phone, address });
      if (!a.ok) return a.message ?? t("error");
      const b = await call("/api/storefront", "PATCH", {
        slug: normalizeSlug(slug),
        supportedLanguages: langs,
        defaultLanguage: langs.includes(defaultLang) ? defaultLang : langs[0],
      });
      if (!b.ok) return b.message ?? t("error");
      const c = await call<OnboardingDTO>("/api/onboarding", "PATCH", { step: "company", action: "done" });
      if (!c.ok) return c.message ?? t("error");
      if (c.data) setDto(c.data);
      router.refresh();
      return null;
    });

  const connectStripe = () =>
    run("payments", async () => {
      const r = await call<{ url: string }>("/api/public-site/payments/connect", "POST");
      if (!r.ok || !r.data?.url) return r.message ?? t("error");
      window.location.assign(r.data.url);
      return null;
    });

  const publish = () =>
    run("publish", async () => {
      const r = await call("/api/storefront", "PATCH", { enabled: true });
      if (!r.ok) return r.message ?? t("error");
      await reload();
      return null;
    });

  const toggleLang = (code: string, on: boolean) =>
    setLangs((prev) => {
      const next = on ? [...prev, code] : prev.filter((c) => c !== code);
      if (next.length === 0) return prev;
      if (!next.includes(defaultLang)) setDefaultLang(next[0]);
      return languages.map((l) => l.code).filter((c) => next.includes(c));
    });

  const previewHref = dto.storefront.slug ? storefrontPath(dto.storefront.slug, dto.storefront.defaultLanguage) : null;
  const stepOf = (k: OnboardingStep) => dto.view.steps.find((s) => s.key === k)!;

  const body: Record<OnboardingStep, React.ReactNode> = {
    company: (
      <div className="dash-form-grid">
        <label className="dash-field">
          {t("phone")}
          <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} autoComplete="tel" />
        </label>
        <label className="dash-field">
          {t("address")}
          <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
        </label>
        <div className="dash-field dash-field--wide">
          {t("languages")}
          <div className="dash-sf-langs">
            {languages.map((l) => (
              <label key={l.code} className="dash-field dash-field--check">
                <input type="checkbox" checked={langs.includes(l.code)} onChange={(e) => toggleLang(l.code, e.target.checked)} />
                {l.name}
              </label>
            ))}
            <label className="dash-field">
              {t("defaultLanguage")}
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
        <label className="dash-field dash-field--wide">
          {t("slug")}
          <div className="dash-sf-slug">
            <span className="dash-sf-prefix">/s/</span>
            <input
              name="slug"
              value={slug}
              maxLength={SLUG_MAX}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <span className="dash-form-note">
            {slugState.kind === "checking" && t("slugChecking")}
            {slugState.kind === "ok" && (
              <span className="dash-sf-ok">
                <Check size={13} /> {t("slugAvailable")}
              </span>
            )}
            {slugState.kind === "error" && <span className="dash-sf-err">{slugState.message}</span>}
          </span>
        </label>
        <div className="dash-onb-actions dash-field--wide">
          <button
            className="dash-btn dash-btn--primary"
            onClick={saveCompany}
            disabled={busy !== "" || slugState.kind === "error" || slugState.kind === "checking"}
          >
            {busy === "company-save" ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    ),
    vehicle: stepOf("vehicle").done ? (
      <p className="dash-form-note">{t("vehicleDone")}</p>
    ) : (
      <button className="dash-btn dash-btn--primary" onClick={() => setVehicleOpen(true)}>
        {t("addVehicle")}
      </button>
    ),
    payments: stepOf("payments").done ? (
      <p className="dash-form-note">{t("paymentsDone")}</p>
    ) : (
      <button className="dash-btn" onClick={connectStripe} disabled={busy !== ""}>
        {t("paymentsButton")}
      </button>
    ),
    publish: !previewHref ? (
      <p className="dash-form-note">{t("needsSlug")}</p>
    ) : (
      <div className="dash-onb-publish">
        {dto.storefront.enabled ? (
          <p className="dash-form-note">
            {t("published")}{" "}
            <a href={previewHref} target="_blank" rel="noopener">
              {previewHref}
            </a>
          </p>
        ) : (
          <>
            <iframe className="dash-onb-preview" src={previewHref} title={t("preview")} />
            <div className="dash-onb-actions">
              <a className="dash-btn" href={previewHref} target="_blank" rel="noopener">
                <ExternalLink size={15} /> {t("openPreview")}
              </a>
              <button className="dash-btn dash-btn--primary" onClick={publish} disabled={busy !== ""} data-testid="onb-publish">
                {busy === "publish" ? t("publishing") : t("publish")}
              </button>
            </div>
          </>
        )}
      </div>
    ),
    domain: stepOf("domain").done ? (
      <p className="dash-form-note">{t("domainDone")}</p>
    ) : (
      <a className="dash-btn" href="/dashboard/storefront?tab=domain">
        {t("domainButton")}
      </a>
    ),
  };

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{t("title")}</h1>
        <p className="dash-page-sub">{t("subtitle")}</p>
      </div>

      {dto.view.complete && <div className="dash-alert-ok dash-onb-done">{t("allDone")}</div>}
      {error && <div className="dash-form-error">{error}</div>}

      <ol className="dash-onb-list">
        {dto.view.steps.map((s) => (
          <li key={s.key} className={`dash-panel dash-onb-step ${s.done ? "is-done" : ""}`} data-step={s.key}>
            <div className="dash-onb-head">
              <span className="dash-onb-icon" aria-hidden="true">
                {s.done ? <Check size={16} /> : s.skipped ? <SkipForward size={16} /> : <CircleDashed size={16} />}
              </span>
              <div className="dash-onb-titles">
                <h2 className="dash-section-title">
                  {t(TITLES[s.key][0])}
                  {!s.required && <span className="dash-onb-tag">{t("optional")}</span>}
                  {s.done && <span className="dash-onb-tag is-ok">{t("done")}</span>}
                  {s.skipped && <span className="dash-onb-tag">{t("skipped")}</span>}
                </h2>
                <p className="dash-form-note">{t(TITLES[s.key][1])}</p>
              </div>
              {!s.done &&
                (s.skipped ? (
                  <button className="dash-btn" onClick={() => mark(s.key, "unskip")} disabled={busy !== ""}>
                    {t("unskip")}
                  </button>
                ) : (
                  <button className="dash-btn" onClick={() => mark(s.key, "skip")} disabled={busy !== ""}>
                    {t("skip")}
                  </button>
                ))}
            </div>
            {(!s.skipped || s.done) && <div className="dash-onb-body">{body[s.key]}</div>}
          </li>
        ))}
      </ol>

      {vehicleOpen && (
        <VehicleModal
          mode="create"
          publicSite={publicSite}
          groups={groups}
          tr={tr}
          onClose={() => setVehicleOpen(false)}
          onSaved={() => {
            setVehicleOpen(false);
            void reload();
          }}
        />
      )}
    </>
  );
}
