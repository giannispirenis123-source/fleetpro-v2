"use client";

// src/app/(dashboard)/dashboard/storefront/DomainTab.tsx
// «Η σελίδα μου» → «Domain»: δικό της domain για το site της εταιρίας.
// Ο server ελέγχει σε κάθε αίτημα (μόνο Διαχειριστής με publicSite), κρατά το
// domain μοναδικό σε όλη την πλατφόρμα και το κάνει VERIFIED ΜΟΝΟ από το
// «Έλεγχος domain» (DNS lookup). Καμία κλήση στο Vercel: οδηγίες βήμα-βήμα.

import { useEffect, useState } from "react";
import { ExternalLink, Globe } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { Status, api } from "./ui";

interface DomainDTO {
  domain: string | null;
  status: "NONE" | "PENDING" | "VERIFIED";
  verifiedAt: string | null;
  slug: string | null;
  dns: { type: "A" | "CNAME"; name: string; value: string } | null;
}

type Verdict =
  | { ok: true; via: "CNAME" | "A"; value: string }
  | { ok: false; reason: "no_records" | "elsewhere"; found: string[] };

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

export default function DomainTab() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const [data, setData] = useState<DomainDTO | null>(null);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [check, setCheck] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState<"" | "save" | "remove" | "check">("");

  useEffect(() => {
    api<DomainDTO>("/api/public-site/domain").then((r) => {
      if (r.ok && r.data) {
        setData(r.data);
        setDraft(r.data.domain ?? "");
      } else setLoadError(r.message || tr("publicSite.errorLoad"));
    });
  }, [tr]);

  if (!data) {
    return <div className="dash-panel dash-settings-panel">{loadError ? <div className="dash-form-error">{loadError}</div> : t("loading")}</div>;
  }

  const apply = (next: DomainDTO) => {
    setData(next);
    setDraft(next.domain ?? "");
  };

  const save = async () => {
    setBusy("save");
    setError("");
    setSaved(false);
    setCheck(null);
    const r = await api<DomainDTO>("/api/public-site/domain", "PUT", { domain: draft });
    setBusy("");
    if (!r.ok || !r.data) return setError(r.message || t("errorSave"));
    apply(r.data);
    setSaved(true);
  };

  const remove = async () => {
    if (!window.confirm(t("domainRemoveConfirm"))) return;
    setBusy("remove");
    setError("");
    setSaved(false);
    setCheck(null);
    const r = await api<DomainDTO>("/api/public-site/domain", "DELETE");
    setBusy("");
    if (!r.ok || !r.data) return setError(r.message || t("errorSave"));
    apply(r.data);
  };

  const verify = async () => {
    setBusy("check");
    setError("");
    setSaved(false);
    setCheck(null);
    const r = await api<{ verdict: Verdict; domain: DomainDTO }>("/api/public-site/domain/verify", "POST");
    setBusy("");
    if (!r.ok || !r.data) return setError(r.message || t("errorSave"));
    apply(r.data.domain);
    const v = r.data.verdict;
    if (v.ok) setCheck({ tone: "ok", text: fill(t("domainCheckOk"), { via: v.via, value: v.value, url: `https://${r.data.domain.domain}/` }) });
    else if (v.reason === "elsewhere") setCheck({ tone: "warn", text: fill(t("domainCheckElsewhere"), { found: v.found.join(", ") }) });
    else setCheck({ tone: "warn", text: t("domainCheckNoRecords") });
  };

  const dirty = draft.trim().toLowerCase() !== (data.domain ?? "");
  const badge = data.status === "VERIFIED" ? "dash-badge--ok" : data.status === "PENDING" ? "dash-badge--warn" : "dash-badge--muted";
  const shown = data.domain ?? "helios-rent.gr";
  const dns = data.dns ?? { type: "CNAME" as const, name: "www", value: "cname.vercel-dns.com" };

  return (
    <>
      <div className="dash-panel dash-settings-panel">
        <p className="dash-form-note dash-settings-lead">{fill(t("domainIntro"), { slug: data.slug ?? "…" })}</p>

        <div className="dash-pay-status">
          <h2 className="dash-section-title">
            <Globe size={16} aria-hidden /> {t("domainStatus")}
          </h2>
          <div className="dash-pay-status-head">
            <span className={`dash-badge ${badge}`}>{t(`domainStatus_${data.status}`)}</span>
            {data.domain && <strong>{data.domain}</strong>}
            {data.verifiedAt && (
              <span className="dash-form-note">
                {fill(t("domainVerifiedAt"), { date: new Date(data.verifiedAt).toLocaleString("el-GR") })}
              </span>
            )}
          </div>
        </div>

        <label className="dash-field dash-field--wide">
          <span>{t("domainField")}</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("domainPlaceholder")}
            maxLength={253}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
          />
        </label>

        <div className="dash-sf-actions">
          <button className="dash-btn dash-btn--primary" onClick={save} disabled={busy !== "" || !draft.trim() || !dirty}>
            {busy === "save" ? "…" : t("domainSave")}
          </button>
          {data.domain && (
            <button className="dash-btn" onClick={verify} disabled={busy !== "" || dirty}>
              {busy === "check" ? t("domainChecking") : t("domainCheck")}
            </button>
          )}
          {data.status === "VERIFIED" && data.domain && (
            <a className="dash-btn" href={`https://${data.domain}/`} target="_blank" rel="noopener">
              <ExternalLink size={14} aria-hidden /> {t("domainOpen")}
            </a>
          )}
          {data.domain && (
            <button className="dash-btn dash-btn--danger" onClick={remove} disabled={busy !== ""}>
              {t("domainRemove")}
            </button>
          )}
        </div>
        {check && <div className={check.tone === "ok" ? "dash-alert-ok" : "dash-alert dash-alert--warn"}>{check.text}</div>}
        <Status error={error} saved={saved} />
      </div>

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">{t("domainStepsTitle")}</h2>
        <ol className="dash-domain-steps">
          <li>{t("domainStep1")}</li>
          <li>{t("domainStep2")}</li>
          <li>{t("domainStep3")}</li>
          <li>
            {t("domainStep4")}
            <div className="dash-domain-dns-wrap">
              <table className="dash-domain-dns">
                <thead>
                  <tr>
                    <th>{t("domainDnsType")}</th>
                    <th>{t("domainDnsName")}</th>
                    <th>{t("domainDnsValue")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{dns.type}</td>
                    <td>
                      <code>{dns.name}</code>
                    </td>
                    <td>
                      <code>{dns.value}</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </li>
          <li>{t("domainStep5")}</li>
          <li>{fill(t("domainStep6"), { domain: shown })}</li>
        </ol>
        <p className="dash-form-note">{t("domainLoginNote")}</p>
      </div>
    </>
  );
}
