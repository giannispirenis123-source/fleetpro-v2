"use client";

// src/app/(dashboard)/dashboard/storefront/PaymentsTab.tsx
// «Η σελίδα μου» → «Πληρωμές»: σύνδεση με Stripe Connect (Express) και
// ρυθμίσεις online πληρωμής. Ο server ελέγχει σε κάθε αίτημα (μόνο
// Διαχειριστής με publicSite) και ξαναϋπολογίζει ό,τι ισχύει.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CreditCard, ExternalLink } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { formatCents } from "@/lib/public/money";
import { ONLINE_AMOUNT_TYPES, PAYMENT_OPTIONS, paymentSplit, type OnlineAmountType, type PaymentOptions } from "@/lib/public/payments";
import { IntInput, Status, api } from "./ui";

interface PaymentsDTO {
  account: { status: "NOT_CONNECTED" | "PENDING" | "ACTIVE"; chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean };
  settings: { paymentOptions: PaymentOptions; onlineAmountType: OnlineAmountType; depositPercent: number };
  effective: PaymentOptions;
  server: { ready: boolean; missing: string[]; live: boolean };
}

const EXAMPLE_TOTAL = 23_450;

export default function PaymentsTab() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const params = useSearchParams();
  const returned = params.get("stripe") === "return";
  const [data, setData] = useState<PaymentsDTO | null>(null);
  const [draft, setDraft] = useState<PaymentsDTO["settings"] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "connect" | "login">("");

  useEffect(() => {
    api<PaymentsDTO>("/api/public-site/payments").then((r) => {
      if (r.ok && r.data) {
        setData(r.data);
        setDraft(r.data.settings);
      } else setLoadError(r.message ?? t("errorLoad"));
    });
    // Μία φόρτωση ανά άνοιγμα της καρτέλας (με επανέλεγχο από το Stripe).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data || !draft) {
    return <div className="dash-panel dash-settings-panel">{loadError ? <div className="dash-form-error">{loadError}</div> : t("loading")}</div>;
  }

  const go = async (kind: "connect" | "login") => {
    setBusy(kind);
    setError("");
    const r = await api<{ url: string }>(`/api/public-site/payments/${kind === "connect" ? "connect" : "login-link"}`, "POST");
    if (r.ok && r.data?.url) {
      if (kind === "connect") window.location.assign(r.data.url);
      else window.open(r.data.url, "_blank", "noopener,noreferrer");
    } else setError(r.message ?? t("errorLoad"));
    setBusy("");
  };

  const save = async () => {
    setBusy("save");
    setError("");
    setSaved(false);
    const r = await api<PaymentsDTO>("/api/public-site/payments", "PATCH", draft);
    if (r.ok && r.data) {
      setData(r.data);
      setDraft(r.data.settings);
      setSaved(true);
    } else setError(r.message ?? t("errorLoad"));
    setBusy("");
  };

  const set = <K extends keyof PaymentsDTO["settings"]>(k: K, v: PaymentsDTO["settings"][K]) => {
    setSaved(false);
    setDraft({ ...draft, [k]: v });
  };

  const status = data.account.status;
  const example = paymentSplit(EXAMPLE_TOTAL, draft.onlineAmountType, draft.depositPercent);
  const depositOk = Number.isInteger(draft.depositPercent) && draft.depositPercent >= 1 && draft.depositPercent <= 100;
  const online = draft.paymentOptions !== "PICKUP_ONLY";

  return (
    <>
      <div className="dash-panel dash-settings-panel">
        <p className="dash-form-note dash-settings-lead">{t("payIntro")}</p>
        {!data.server.ready && (
          <div className="dash-alert dash-alert--warn">{t("payServerMissing").replace("{names}", data.server.missing.join(", "))}</div>
        )}

        <div className="dash-pay-status">
          <h2 className="dash-section-title">{t("payAccountTitle")}</h2>
          <div className="dash-pay-status-head">
            <span className={`dash-badge dash-badge--${status === "ACTIVE" ? "ok" : status === "PENDING" ? "warn" : "muted"}`}>
              <CreditCard size={13} /> {t(`payStatus_${status}`)}
            </span>
            {data.server.ready && !data.server.live && <span className="dash-badge dash-badge--info">{t("payTestMode")}</span>}
            {status !== "NOT_CONNECTED" && (
              <span className="dash-form-note">
                {t("payCharges")}: {data.account.chargesEnabled ? t("payYes") : t("payNo")} · {t("payPayouts")}:{" "}
                {data.account.payoutsEnabled ? t("payYes") : t("payNo")}
              </span>
            )}
          </div>
          <p className="dash-form-note">{t(`payStatusHint_${status}`)}</p>
          {returned && status !== "ACTIVE" && <p className="dash-form-note">{t("payReturned")}</p>}
          <div className="dash-ps-row">
            {status !== "ACTIVE" && (
              <button className="dash-btn dash-btn--primary" disabled={!data.server.ready || busy !== ""} onClick={() => go("connect")}>
                {status === "NOT_CONNECTED" ? t("payConnect") : t("payContinue")}
              </button>
            )}
            {data.account.detailsSubmitted && (
              <button className="dash-btn" disabled={!data.server.ready || busy !== ""} onClick={() => go("login")}>
                {t("payDashboard")} <ExternalLink size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">{t("payOptionsTitle")}</h2>
        <div className="dash-pay-options" role="radiogroup" aria-label={t("payOptionsTitle")}>
          {PAYMENT_OPTIONS.map((o) => (
            <label key={o} className={`dash-pay-option${draft.paymentOptions === o ? " is-on" : ""}`}>
              <input type="radio" name="paymentOptions" checked={draft.paymentOptions === o} onChange={() => set("paymentOptions", o)} />
              <span>{t(`payOpt_${o}`)}</span>
              <small>{t(`payOptHint_${o}`)}</small>
            </label>
          ))}
        </div>
        {online && status !== "ACTIVE" && <div className="dash-alert dash-alert--warn">{t("payNeedsActive")}</div>}

        {online && (
          <>
            <h2 className="dash-section-title">{t("payAmountTitle")}</h2>
            <div className="dash-pay-options" role="radiogroup" aria-label={t("payAmountTitle")}>
              {ONLINE_AMOUNT_TYPES.map((a) => (
                <label key={a} className={`dash-pay-option${draft.onlineAmountType === a ? " is-on" : ""}`}>
                  <input type="radio" name="onlineAmountType" checked={draft.onlineAmountType === a} onChange={() => set("onlineAmountType", a)} />
                  <span>{t(`payAmount_${a}`)}</span>
                </label>
              ))}
            </div>
            {draft.onlineAmountType === "DEPOSIT" && (
              <IntInput
                label={t("payDepositPercent")}
                value={draft.depositPercent}
                min={1}
                max={100}
                onChange={(v) => set("depositPercent", v ?? 0)}
                hint={t("payDepositHint")}
              />
            )}
            <p className="dash-form-note">
              {t("payExample")
                .replace("{total}", formatCents(EXAMPLE_TOTAL, "el"))
                .replace("{now}", formatCents(example.nowCents, "el"))
                .replace("{later}", formatCents(example.laterCents, "el"))}
            </p>
          </>
        )}

        <p className="dash-form-note">
          {t("payEffective")}: <strong>{t(`payOpt_${data.effective}`)}</strong>
        </p>
        <p className="dash-form-note">{t("payHoldNote")}</p>
        <p className="dash-form-note">{t("payRefundNote")}</p>

        <div className="dash-sf-actions">
          <button className="dash-btn dash-btn--primary" onClick={save} disabled={busy !== "" || !depositOk}>
            {t("save")}
          </button>
          <Status error={error} saved={saved} />
        </div>
      </div>
    </>
  );
}
