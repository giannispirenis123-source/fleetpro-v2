"use client";

// Ρυθμίσεις → «Αποστολέας email» — ΜΟΝΟ Διαχειριστής (το ελέγχει και ο server).
// Όνομα και διεύθυνση αποστολής της εταιρίας, με οδηγίες για την επαλήθευση
// του domain στο Resend. Η επαλήθευση δηλώνεται χειροκίνητα (τικ)· χωρίς αυτήν
// τα email φεύγουν από τον κοινό αποστολέα (EMAIL_FROM), όπως σήμερα.

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { EMAIL_FROM_ADDRESS_MAX, EMAIL_FROM_NAME_MAX, formatSender, senderDomain } from "@/lib/emailSender";

interface SenderDTO {
  name: string;
  address: string;
  status: "UNVERIFIED" | "VERIFIED";
  verifiedAt: string | null;
  domain: string | null;
  usingOwn: boolean;
}

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

export default function EmailSenderSettings() {
  const tr = useT();
  const t = (k: string) => tr(`settings.${k}`);
  const [data, setData] = useState<SenderDTO | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const apply = (d: SenderDTO) => {
    setData(d);
    setName(d.name);
    setAddress(d.address);
    setVerified(d.status === "VERIFIED");
  };

  useEffect(() => {
    fetch("/api/settings/email-sender")
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => (ok && j.data ? apply(j.data) : setError(j.message || "—")))
      .catch(() => setError("—"));
  }, []);

  if (!data) {
    return <div className="dash-panel dash-settings-panel">{error ? <div className="dash-form-error">{error}</div> : "…"}</div>;
  }

  const addressChanged = address.trim().toLowerCase() !== data.address;
  const domain = senderDomain(address) ?? data.domain ?? "helios-rent.gr";

  const save = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/settings/email-sender", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address, verified }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.data) return setError(j.message || "—");
      apply(j.data);
      setSaved(true);
    } catch {
      setError("—");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dash-panel dash-settings-panel">
      <h2 className="dash-section-title">
        <Mail size={16} aria-hidden /> {t("senderTitle")}
      </h2>
      <p className="dash-form-note">{t("senderIntro")}</p>
      <p className="dash-form-note">
        <span className={`dash-badge ${data.usingOwn ? "dash-badge--ok" : "dash-badge--muted"}`}>
          {data.usingOwn
            ? fill(t("senderStatusUsingOwn"), { from: formatSender(data.name, data.address) ?? data.address })
            : t("senderStatusShared")}
        </span>
        {data.verifiedAt && <> {fill(t("senderVerifiedAt"), { date: new Date(data.verifiedAt).toLocaleString("el-GR") })}</>}
      </p>

      <div className="dash-form-grid">
        <label className="dash-field">
          <span>{t("senderName")}</span>
          <input value={name} maxLength={EMAIL_FROM_NAME_MAX} placeholder={t("senderNamePlaceholder")} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="dash-field">
          <span>{t("senderAddress")}</span>
          <input
            type="email"
            value={address}
            maxLength={EMAIL_FROM_ADDRESS_MAX}
            placeholder={t("senderAddressPlaceholder")}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => {
              setAddress(e.target.value);
              // Νέα διεύθυνση = ξανά επαλήθευση (ποτέ δεν «κληρονομείται»).
              setVerified(false);
            }}
          />
        </label>
      </div>
      <label className="dash-check">
        <input type="checkbox" checked={verified} disabled={!address.trim()} onChange={(e) => setVerified(e.target.checked)} />
        <span>{t("senderVerified")}</span>
      </label>
      {verified && (addressChanged || data.status !== "VERIFIED") && <div className="dash-alert dash-alert--warn">{t("senderVerifiedWarn")}</div>}

      <div className="dash-sf-actions">
        <button className="dash-btn dash-btn--primary" onClick={save} disabled={busy}>
          {busy ? "…" : t("senderSave")}
        </button>
      </div>
      {error && <div className="dash-form-error">{error}</div>}
      {saved && <div className="dash-alert-ok dash-settings-saved">✓</div>}

      <h2 className="dash-section-title dash-settings-second">{t("senderStepsTitle")}</h2>
      <ol className="dash-domain-steps">
        <li>{t("senderStep1")}</li>
        <li>{fill(t("senderStep2"), { domain })}</li>
        <li>{t("senderStep3")}</li>
        <li>{t("senderStep4")}</li>
        <li>{fill(t("senderStep5"), { domain })}</li>
        <li>{t("senderStep6")}</li>
      </ol>
    </div>
  );
}
