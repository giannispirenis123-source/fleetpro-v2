"use client";

// «Οικονομικά» του συνεργάτη: λίστα των δικών του κρατήσεων + δύο σύνολα.
// Τα δεδομένα έρχονται ΜΟΝΟ από το GET /api/partner/finance (φίλτρο στον server).

import { useEffect, useRef, useState } from "react";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import { formatMoney } from "@/lib/public/money";
import { BOOKING_STATUS_CLASS } from "@/lib/bookings";
import type { PartnerFinanceRow, PartnerFinanceTotals } from "@/lib/partnerFinance";

type Data = { items: PartnerFinanceRow[]; totals: PartnerFinanceTotals };

const fmtDate = (iso: string, locale: string) =>
  new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(locale === "en" ? "en-GB" : "el-GR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });

export default function PartnerFinanceClient({ initialMonth, initial }: { initialMonth: string; initial: Data }) {
  const tr = useT();
  const locale = useLocale();
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<Data>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/partner/finance?month=${encodeURIComponent(month)}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j.message);
        setData({ items: j.data.items, totals: j.data.totals });
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError(tr("partner.error"));
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [month, tr]);

  const money = (c: number) => formatMoney(c, locale);

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{tr("partner.financeTitle")}</h1>
        <p className="dash-page-sub">{tr("partner.financeSubtitle")}</p>
      </div>

      <div className="dash-toolbar">
        <label className="dash-field dash-field--inline">
          {tr("partner.month")}
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="partner-month" />
        </label>
        <button type="button" className="dash-btn" onClick={() => setMonth("")} disabled={month === ""}>
          {tr("partner.allMonths")}
        </button>
        {loading && <span className="dash-count">{tr("partner.loading")}</span>}
      </div>
      {error && <div className="dash-form-error">{error}</div>}

      <div className="dash-panel">
        {data.items.length === 0 ? (
          <p className="dash-form-note">{tr("partner.empty")}</p>
        ) : (
          <div className="dash-invoices" data-testid="partner-finance-list">
            {data.items.map((b) => (
              <div key={b.id} className={`dash-invoice${b.counted ? "" : " dash-pf-uncounted"}`} data-testid="partner-finance-row">
                <div className="dash-invoice-id">
                  <span className="dash-invoice-number">{b.bookingNumber}</span>
                  <span className="dash-invoice-booking">
                    {fmtDate(b.pickupDate, locale)} – {fmtDate(b.returnDate, locale)}
                  </span>
                </div>
                <div className="dash-invoice-who">
                  <span className="dash-invoice-customer">{b.vehicle}</span>
                  <span>
                    <span className={`dash-status dash-status--${BOOKING_STATUS_CLASS[b.status] ?? "muted"}`}>{tr(`status.${b.status}`)}</span>
                    {b.refunded && <span className="dash-status dash-status--muted"> {tr("partner.refunded")}</span>}
                  </span>
                  {!b.counted && <span className="dash-invoice-booking">{tr("partner.notCounted")}</span>}
                </div>
                <div className="dash-invoice-money">
                  <span className="dash-invoice-total" data-testid="pf-amount">{money(b.totalCents)}</span>
                  <span className="dash-invoice-booking">
                    {tr("partner.commission")}: <strong data-testid="pf-commission">{money(b.commissionCents)}</strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="dash-kpis dash-pf-totals">
        <div className="dash-card">
          <div>
            <span className="dash-card-value" data-testid="pf-total">{money(data.totals.totalCents)}</span>
            <span className="dash-card-label">{tr("partner.totalBookings")}</span>
          </div>
        </div>
        <div className="dash-card dash-card--green">
          <div>
            <span className="dash-card-value" data-testid="pf-net">{money(data.totals.commissionCents)}</span>
            <span className="dash-card-label">{tr("partner.netCommission")}</span>
          </div>
        </div>
      </div>
      <p className="dash-form-note">{tr("partner.countedNote")}</p>
    </>
  );
}
