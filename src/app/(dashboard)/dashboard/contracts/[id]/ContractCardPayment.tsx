"use client";

// src/app/(dashboard)/dashboard/contracts/[id]/ContractCardPayment.tsx
// Πληρωμή ενοικίου με κάρτα μέσω Stripe, μέσα στο συμβόλαιο: κατάσταση
// (σε αναμονή / πληρώθηκε / απέτυχε…), link + QR για το κινητό του πελάτη,
// «Αποστολή link», «Έλεγχος πληρωμής» και επιστροφή (μόνο Διαχειριστής).
// Ποσό και «πληρώθηκε» ΜΟΝΟ από τον server — ο browser δεν στέλνει ποσά.

import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, Copy, QrCode, RefreshCw, Send, Undo2 } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { formatCents } from "@/lib/public/money";
import type { ContractPaymentDTO } from "@/lib/contractPayment";

const BADGE: Record<string, string> = {
  PAID: "ok",
  PARTIALLY_REFUNDED: "ok",
  REFUNDED: "muted",
  AWAITING: "warn",
  FAILED: "bad",
  EXPIRED: "muted",
  NONE: "muted",
};

export default function ContractCardPayment({
  contractId,
  bookingId,
  canEdit,
  canRefund,
  onChange,
}: {
  contractId: string;
  bookingId: string;
  canEdit: boolean;
  canRefund: boolean;
  /** Ο γονέας χρειάζεται το completionBlock (κουμπί «Ολοκλήρωση»). */
  onChange?: (p: ContractPaymentDTO | null) => void;
}) {
  const tr = useT();
  const t = (k: string) => tr(`contracts.${k}`);
  const [data, setData] = useState<ContractPaymentDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [qr, setQr] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const apply = useCallback((d: ContractPaymentDTO | null) => {
    setData(d);
    onChangeRef.current?.(d);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/contracts/${contractId}/payment`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data) apply(json.data);
    } catch {
      /* σιωπηλά: η επόμενη ανανέωση ξαναδοκιμάζει */
    }
  }, [contractId, apply]);

  useEffect(() => {
    load();
  }, [load]);

  // Όσο περιμένει πληρωμή: ανανέωση κάθε 5΄΄ (η βάση ενημερώνεται από το webhook).
  const awaiting = data?.status === "AWAITING";
  useEffect(() => {
    if (!awaiting) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [awaiting, load]);

  if (!data) return <p className="dash-form-note">{t("cardPayLoading")}</p>;
  if (data.mode !== "STRIPE") return null;

  const call = async (url: string, body?: unknown) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.message || tr("contracts.errorSave"));
        return null;
      }
      return json.data ?? {};
    } catch {
      setError(tr("contracts.errorConnection"));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    const d = await call(`/api/contracts/${contractId}/payment`);
    if (d) {
      apply(d);
      setQr(true);
    }
  };

  const check = async () => {
    const d = await call(`/api/contracts/${contractId}/payment/check`);
    if (d?.payment) {
      apply(d.payment);
      if (d.payment.status === "AWAITING") setNotice(t("cardPayStillPending"));
    }
  };

  const refund = async () => {
    const eur = refundAmount.trim().replace(",", ".");
    const cents = eur === "" ? null : Math.round(Number(eur) * 100);
    if (cents !== null && (!Number.isFinite(cents) || cents < 1)) return;
    const d = await call(`/api/bookings/${bookingId}/refund`, { amountCents: cents, scope: "contract" });
    if (d) {
      setRefundOpen(false);
      setRefundAmount("");
      setNotice(t("cardPayRefundDone"));
      await load();
    }
  };

  const url = data.payment?.url ?? null;
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNotice(t("cardPayCopied"));
    } catch {
      /* ο browser δεν επιτρέπει clipboard — φαίνεται το link */
    }
  };
  const share = async () => {
    if (!url) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: t("cardPayShareText"), text: t("cardPayShareText"), url });
      } catch {
        /* ακύρωση από τον χρήστη */
      }
    } else {
      await copy();
    }
  };

  const status = data.status;
  const paid = status === "PAID" || status === "PARTIALLY_REFUNDED";
  const canOpen = canEdit && data.openBlock === null && (status === "NONE" || status === "EXPIRED" || status === "FAILED");
  const refundable = data.payment ? data.payment.amountCents - data.payment.refundedCents : 0;
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("el-GR", { timeZone: "Europe/Athens", dateStyle: "short", timeStyle: "short" }) : "";

  return (
    <div className="dash-contract-cardpay">
      <h3 className="dash-section-title">
        <CreditCard size={16} /> {t("cardPayTitle")}
      </h3>
      <div className="dash-pay-status-head">
        <span className={`dash-badge dash-badge--${BADGE[status] ?? "muted"}`}>{t(`cardPayStatus_${status}`)}</span>
        <span className="dash-form-note">
          {t("cardPayAmount")}: <strong>{formatCents(data.payment && status !== "NONE" ? data.payment.amountCents : data.dueCents, "el")}</strong>
        </span>
      </div>
      {data.payment?.paidAt && paid && (
        <p className="dash-form-note">
          {t("cardPayPaidAt")} {when(data.payment.paidAt)}
        </p>
      )}
      {data.payment && data.payment.refundedCents > 0 && (
        <p className="dash-form-note">
          {t("cardPayRefunded")}: {formatCents(data.payment.refundedCents, "el")}
        </p>
      )}
      {data.openBlock && !paid && status !== "REFUNDED" && status !== "AWAITING" && (
        <p className="dash-form-note">{data.openBlock}</p>
      )}

      {url && (
        <>
          <p className="dash-form-note dash-contract-cardpay-url">{url}</p>
          {data.payment?.expiresAt && (
            <p className="dash-form-note">
              {t("cardPayExpires")} {when(data.payment.expiresAt)}
            </p>
          )}
          <div className="dash-ps-row">
            <button className="dash-btn" onClick={() => setQr((v) => !v)}>
              <QrCode size={15} /> {qr ? t("cardPayHideQr") : t("cardPayShowQr")}
            </button>
            <button className="dash-btn" onClick={share}>
              <Send size={15} /> {t("cardPayShare")}
            </button>
            <button className="dash-btn" onClick={copy}>
              <Copy size={15} /> {t("cardPayCopy")}
            </button>
          </div>
          {qr && data.payment?.qrSvg && (
            <div className="dash-contract-cardpay-qr">
              {/* SVG από τη βιβλιοθήκη qrcode στον server, μόνο για το URL του Stripe. */}
              <div dangerouslySetInnerHTML={{ __html: data.payment.qrSvg }} />
              <p className="dash-form-note">{t("cardPayQrHint")}</p>
            </div>
          )}
        </>
      )}

      <div className="dash-ps-row">
        {canOpen && (
          <button className="dash-btn dash-btn--primary" disabled={busy} onClick={open}>
            <QrCode size={15} /> {status === "NONE" ? t("cardPayCreate") : t("cardPayNew")}
          </button>
        )}
        {canEdit && status === "AWAITING" && (
          <button className="dash-btn" disabled={busy} onClick={check}>
            <RefreshCw size={15} /> {t("cardPayCheck")}
          </button>
        )}
        {canRefund && paid && refundable > 0 && !refundOpen && (
          <button className="dash-btn" disabled={busy} onClick={() => setRefundOpen(true)}>
            <Undo2 size={15} /> {t("cardPayRefund")}
          </button>
        )}
      </div>

      {refundOpen && (
        <div className="dash-ps-row">
          <label className="dash-field">
            {t("cardPayRefundAmount")}
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              max={(refundable / 100).toFixed(2)}
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
            />
          </label>
          <button className="dash-btn dash-btn--primary" disabled={busy} onClick={refund}>
            {t("cardPayRefundConfirm")}
          </button>
          <button className="dash-btn" disabled={busy} onClick={() => setRefundOpen(false)}>
            {tr("common.cancel")}
          </button>
        </div>
      )}

      {error && <div className="dash-form-error">{error}</div>}
      {notice && <div className="dash-alert-ok">{notice}</div>}
    </div>
  );
}
