"use client";

// «Προμήθειες συνεργατών»: πίνακας ανά συνεργάτη + γενικά σύνολα, φίλτρο μήνα
// (ίδιο με τα «Οικονομικά»). Πάτημα σε συνεργάτη → οι κρατήσεις του με την ΙΔΙΑ
// εμφάνιση (PartnerFinanceRows). Όλα από τον server (GET /api/partner-commissions).

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import { formatMoney } from "@/lib/public/money";
import type { PartnerFinanceRow, PartnerFinanceTotals } from "@/lib/partnerFinance";
import { PartnerFinanceRows } from "../partner/finance/PartnerFinanceClient";

type PartnerLine = PartnerFinanceTotals & { id: string; name: string; isActive: boolean; rate: number };
type Overview = { partners: PartnerLine[]; totals: PartnerFinanceTotals };
type Detail = { partner: { id: string; name: string; rate: number }; items: PartnerFinanceRow[]; totals: PartnerFinanceTotals };

const pct = (n: number, locale: string) => `${String(n).replace(".", locale === "en" ? "." : ",")}%`;

export default function PartnerCommissionsClient({ initialMonth, initial }: { initialMonth: string; initial: Overview }) {
  const tr = useT();
  const locale = useLocale();
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<Overview>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<PartnerLine | null>(null);
  const first = useRef(true);
  const money = (c: number) => formatMoney(c, locale);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/partner-commissions?month=${encodeURIComponent(month)}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j.message);
        setData({ partners: j.data.partners, totals: j.data.totals });
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError(tr("partner.error"));
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [month, tr]);

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{tr("partnerCommissions.title")}</h1>
        <p className="dash-page-sub">{tr("partnerCommissions.subtitle")}</p>
      </div>

      <div className="dash-toolbar">
        <label className="dash-field dash-field--inline">
          {tr("partner.month")}
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="pc-month" />
        </label>
        <button type="button" className="dash-btn" onClick={() => setMonth("")} disabled={month === ""} data-testid="pc-all-months">
          {tr("partner.allMonths")}
        </button>
        {loading && <span className="dash-count">{tr("partner.loading")}</span>}
      </div>
      {error && <div className="dash-form-error">{error}</div>}

      <div className="dash-panel dash-pc-wrap">
        {data.partners.length === 0 ? (
          <p className="dash-form-note">{tr("partnerCommissions.noPartners")}</p>
        ) : (
          <table className="dash-pc-table" data-testid="pc-table">
            <thead>
              <tr>
                <th scope="col">{tr("partnerCommissions.partner")}</th>
                <th scope="col" className="num">{tr("partnerCommissions.rate")}</th>
                <th scope="col" className="num">{tr("partnerCommissions.bookings")}</th>
                <th scope="col" className="num">{tr("partner.totalBookings")}</th>
                <th scope="col" className="num">{tr("partnerCommissions.commission")}</th>
              </tr>
            </thead>
            <tbody>
              {data.partners.map((p) => (
                <tr key={p.id} data-testid="pc-row" data-partner={p.id}>
                  <th scope="row">
                    <button type="button" className="dash-link-btn" onClick={() => setOpen(p)} data-testid="pc-open">
                      {p.name}
                    </button>
                    {!p.isActive && <span className="dash-status dash-status--muted"> {tr("partnerCommissions.inactive")}</span>}
                  </th>
                  <td className="num" data-label={tr("partnerCommissions.rate")}>{pct(p.rate, locale)}</td>
                  <td className="num" data-label={tr("partnerCommissions.bookings")} data-testid="pc-count">{p.bookings}</td>
                  <td className="num" data-label={tr("partner.totalBookings")} data-testid="pc-total">{money(p.totalCents)}</td>
                  <td className="num" data-label={tr("partnerCommissions.commission")} data-testid="pc-commission">{money(p.commissionCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-testid="pc-totals">
                <th scope="row">{tr("partnerCommissions.allPartners")}</th>
                <td className="dash-pc-empty" />
                <td className="num" data-label={tr("partnerCommissions.bookings")} data-testid="pc-sum-count">{data.totals.bookings}</td>
                <td className="num" data-label={tr("partner.totalBookings")} data-testid="pc-sum-total">{money(data.totals.totalCents)}</td>
                <td className="num" data-label={tr("partnerCommissions.commission")} data-testid="pc-sum-commission">{money(data.totals.commissionCents)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <p className="dash-form-note">{tr("partner.countedNote")}</p>

      {open && <PartnerDetailModal partner={open} month={month} onClose={() => setOpen(null)} />}
    </>
  );
}

function PartnerDetailModal({ partner, month, onClose }: { partner: PartnerLine; month: string; onClose: () => void }) {
  const tr = useT();
  const locale = useLocale();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/partner-commissions/${encodeURIComponent(partner.id)}?month=${encodeURIComponent(month)}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j.message);
        setDetail(j.data);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError(tr("partner.error"));
      });
    return () => ctrl.abort();
  }, [partner.id, month, tr]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" role="dialog" aria-modal="true" aria-labelledby="pc-detail-title" onClick={(e) => e.stopPropagation()} data-testid="pc-detail">
        <div className="dash-modal-header">
          <h2 id="pc-detail-title">
            {partner.name} · {pct(partner.rate, locale)}
          </h2>
          <button className="dash-modal-close" onClick={onClose} aria-label={tr("partner.cancel")}>
            <X size={18} />
          </button>
        </div>
        <div className="dash-modal-body">
          {error && <div className="dash-form-error">{error}</div>}
          {!detail && !error && <p className="dash-form-note">{tr("partner.loading")}</p>}
          {detail &&
            (detail.items.length === 0 ? (
              <p className="dash-form-note">{tr("partner.empty")}</p>
            ) : (
              <PartnerFinanceRows items={detail.items} />
            ))}
          {detail && (
            <dl className="dash-pb-price" data-testid="pc-detail-totals">
              <dt>{tr("partner.totalBookings")}</dt>
              <dd data-testid="pc-detail-total">{formatMoney(detail.totals.totalCents, locale)}</dd>
              <dt>{tr("partner.netCommission")}</dt>
              <dd data-testid="pc-detail-commission">{formatMoney(detail.totals.commissionCents, locale)}</dd>
            </dl>
          )}
          <p className="dash-form-note">{tr("partner.countedNote")}</p>
        </div>
        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose}>{tr("partner.cancel")}</button>
        </div>
      </div>
    </div>
  );
}
