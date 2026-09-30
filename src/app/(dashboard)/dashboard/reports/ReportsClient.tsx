"use client";

import { useEffect, useRef, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Receipt,
  CalendarDays,
  Clock,
  Gauge,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import type { Report } from "@/lib/reports";

const INTL: Record<string, string> = { el: "el-GR", en: "en-GB" };

const eur = (n: number, locale: string) =>
  new Intl.NumberFormat(INTL[locale] ?? "el-GR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);

const num = (n: number, locale: string) =>
  new Intl.NumberFormat(INTL[locale] ?? "el-GR", {
    maximumFractionDigits: 1,
  }).format(n);

/** "YYYY-MM" → σύντομο όνομα μήνα. */
const monthName = (ym: string, locale: string) =>
  new Intl.DateTimeFormat(INTL[locale] ?? "el-GR", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${ym}-01T00:00:00.000Z`));

/* ─────────────────────────────────────────────
   Σελίδα
   ───────────────────────────────────────────── */

export default function ReportsClient({
  initialReport,
  years,
}: {
  initialReport: Report;
  years: number[];
}) {
  const tr = useT();
  const locale = useLocale();

  const [year, setYear] = useState(initialReport.year);
  const [report, setReport] = useState(initialReport);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Αγνοούμε απαντήσεις παλαιότερων αιτημάτων όταν ο χρήστης αλλάζει
  // γρήγορα έτος.
  const requestSeq = useRef(0);
  const firstRun = useRef(true);

  useEffect(() => {
    // Η πρώτη φόρτωση ήρθε ήδη από τον server.
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");

    (async () => {
      try {
        const res = await fetch(`/api/reports?year=${year}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (seq !== requestSeq.current) return;
        if (!res.ok) {
          setError(data.message || tr("reports.errorLoad"));
          return;
        }
        setReport(data.data.report);
      } catch {
        if (seq === requestSeq.current) setError(tr("reports.errorConnection"));
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    })();
  }, [year, tr]);

  const { kpis, months, topVehicles, categories } = report;
  const maxMonth = Math.max(0, ...months.flatMap((m) => [m.revenueNet, m.expenses]));
  const maxVehicle = Math.max(0, ...topVehicles.map((v) => v.revenueNet));
  const maxCategory = Math.max(0, ...categories.map((c) => c.revenueNet));
  const hasMonthly = maxMonth > 0;

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{tr("reports.title")}</h1>
        <p className="dash-page-sub">{tr("reports.subtitle")}</p>
      </div>

      {/* ── Έτος ── */}
      <div className="dash-toolbar">
        <label className="dash-field dash-field--inline">
          {tr("reports.year")}
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        {loading && <span className="dash-count">{tr("reports.loading")}</span>}
      </div>

      {error && <div className="dash-form-error">{error}</div>}

      {/* ── KPIs ── */}
      <div className="dash-kpis">
        <div className="dash-card dash-card--green">
          <div className="dash-card-icon">
            <TrendingUp size={22} />
          </div>
          <div>
            <span className="dash-card-value">{eur(kpis.revenueNet, locale)}</span>
            <span className="dash-card-label">
              {tr("reports.revenue")} · <strong>{tr("reports.revenueNote")}</strong>
            </span>
            <span className="dash-card-label">
              {kpis.paidInvoices} {tr("reports.paidInvoices")}
            </span>
          </div>
        </div>

        <div className="dash-card dash-card--amber">
          <div className="dash-card-icon">
            <TrendingDown size={22} />
          </div>
          <div>
            <span className="dash-card-value">{eur(kpis.expenses, locale)}</span>
            <span className="dash-card-label">{tr("reports.expenses")}</span>
          </div>
        </div>

        <div className={`dash-card ${kpis.profit < 0 ? "dash-fin-loss" : "dash-card--indigo"}`}>
          <div className="dash-card-icon">
            <Wallet size={22} />
          </div>
          <div>
            <span className="dash-card-value">{eur(kpis.profit, locale)}</span>
            <span className="dash-card-label">{tr("reports.profit")}</span>
          </div>
        </div>

        <div className="dash-card dash-card--emerald">
          <div className="dash-card-icon">
            <Receipt size={22} />
          </div>
          <div>
            <span className="dash-card-value">{eur(kpis.avgInvoiceNet, locale)}</span>
            <span className="dash-card-label">
              {tr("reports.avgInvoice")} · {tr("reports.avgInvoiceNote")}
            </span>
          </div>
        </div>

        <div className="dash-card dash-card--violet">
          <div className="dash-card-icon">
            <CalendarDays size={22} />
          </div>
          <div>
            <span className="dash-card-value">{kpis.bookings}</span>
            <span className="dash-card-label">{tr("reports.bookings")}</span>
            <span className="dash-card-label">
              {kpis.cancelledBookings} {tr("reports.cancelled")}
            </span>
          </div>
        </div>

        <div className="dash-card dash-card--indigo">
          <div className="dash-card-icon">
            <Clock size={22} />
          </div>
          <div>
            <span className="dash-card-value">
              {num(kpis.avgRentalDays, locale)} {tr("reports.days")}
            </span>
            <span className="dash-card-label">{tr("reports.avgRental")}</span>
            <span className="dash-card-label">
              {kpis.rentalDays} {tr("reports.rentalDaysTotal")}
            </span>
          </div>
        </div>

        <div className="dash-card dash-card--green">
          <div className="dash-card-icon">
            <Gauge size={22} />
          </div>
          <div>
            <span className="dash-card-value">
              {kpis.utilization === null
                ? tr("reports.notAvailable")
                : `${num(kpis.utilization, locale)}%`}
            </span>
            <span className="dash-card-label" title={tr("reports.utilizationNote")}>
              {tr("reports.utilization")}
            </span>
            <span className="dash-card-label">
              {kpis.activeVehicles} {tr("reports.activeVehicles")}
            </span>
          </div>
        </div>
      </div>

      {/* ── Ανά μήνα ── */}
      <div className="dash-panel dash-fin-panel">
        <h2 className="dash-section-title">{tr("reports.monthly")}</h2>
        <p className="dash-form-note">{tr("reports.monthlyNote")}</p>

        {!hasMonthly ? (
          <p className="dash-form-note">{tr("reports.noData")}</p>
        ) : (
          <>
            <div className="dash-rep-legend">
              <span>
                <i className="dash-rep-dot dash-rep-dot--rev" /> {tr("reports.legendRevenue")}
              </span>
              <span>
                <i className="dash-rep-dot dash-rep-dot--exp" /> {tr("reports.legendExpenses")}
              </span>
            </div>
            <div className="dash-rep-chart" role="img" aria-label={tr("reports.monthly")}>
              {months.map((m) => (
                <div
                  key={m.month}
                  className="dash-rep-col"
                  title={`${monthName(m.month, locale)} · ${tr("reports.legendRevenue")} ${eur(
                    m.revenueNet,
                    locale
                  )} · ${tr("reports.legendExpenses")} ${eur(m.expenses, locale)}`}
                >
                  <div className="dash-rep-bars">
                    <div
                      className="dash-rep-bar dash-rep-bar--rev"
                      style={{ height: `${(m.revenueNet / maxMonth) * 100}%` }}
                    />
                    <div
                      className="dash-rep-bar dash-rep-bar--exp"
                      style={{ height: `${(m.expenses / maxMonth) * 100}%` }}
                    />
                  </div>
                  <span className="dash-rep-col-label">{monthName(m.month, locale)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="dash-rep-table-wrap">
          <table className="dash-rep-table">
            <thead>
              <tr>
                <th>{tr("reports.month")}</th>
                <th>{tr("reports.revenue")}</th>
                <th>{tr("reports.expenses")}</th>
                <th>{tr("reports.profit")}</th>
                <th>{tr("reports.bookings")}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <td>{monthName(m.month, locale)}</td>
                  <td>{eur(m.revenueNet, locale)}</td>
                  <td>{eur(m.expenses, locale)}</td>
                  <td className={m.profit < 0 ? "dash-rep-neg" : undefined}>
                    {eur(m.profit, locale)}
                  </td>
                  <td>{m.bookings}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{tr("reports.total")}</td>
                <td>{eur(kpis.revenueNet, locale)}</td>
                <td>{eur(kpis.expenses, locale)}</td>
                <td className={kpis.profit < 0 ? "dash-rep-neg" : undefined}>
                  {eur(kpis.profit, locale)}
                </td>
                <td>{kpis.bookings}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="dash-rep-grid">
        {/* ── Top οχήματα ── */}
        <div className="dash-panel dash-fin-panel">
          <h2 className="dash-section-title">{tr("reports.topVehicles")}</h2>
          <p className="dash-form-note">{tr("reports.topVehiclesNote")}</p>
          {topVehicles.length === 0 ? (
            <p className="dash-form-note">{tr("reports.noData")}</p>
          ) : (
            <div className="dash-fin-bars">
              {topVehicles.map((v, i) => (
                <div key={v.vehicleId} className="dash-rep-vehicle">
                  <div className="dash-rep-vehicle-head">
                    <span className="dash-rep-rank">{i + 1}</span>
                    <span className="dash-rep-vehicle-label">
                      {v.label}
                      <small>
                        {tr(`vehicleCategory.${v.category}`)} · {v.bookings}{" "}
                        {tr("reports.bookings").toLowerCase()} · {v.rentalDays}{" "}
                        {tr("reports.days")}
                      </small>
                    </span>
                    <span className="dash-fin-bar-amount">{eur(v.revenueNet, locale)}</span>
                  </div>
                  <div className="dash-fin-bar-track">
                    <div
                      className="dash-fin-bar-fill"
                      style={{
                        width: `${maxVehicle > 0 ? (v.revenueNet / maxVehicle) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Κατηγορίες ── */}
        <div className="dash-panel dash-fin-panel">
          <h2 className="dash-section-title">{tr("reports.byCategory")}</h2>
          {categories.length === 0 ? (
            <p className="dash-form-note">{tr("reports.noData")}</p>
          ) : (
            <div className="dash-fin-bars">
              {categories.map((c) => (
                <div key={c.category} className="dash-rep-vehicle">
                  <div className="dash-rep-vehicle-head">
                    <span className="dash-rep-vehicle-label">
                      {tr(`vehicleCategory.${c.category}`)}
                      <small>
                        {c.vehicles} {tr("reports.vehicles").toLowerCase()} · {c.bookings}{" "}
                        {tr("reports.bookings").toLowerCase()}
                      </small>
                    </span>
                    <span className="dash-fin-bar-amount">
                      {eur(c.revenueNet, locale)}
                      <small> · {Math.round(c.percent)}%</small>
                    </span>
                  </div>
                  <div
                    className="dash-fin-bar-track"
                    role="progressbar"
                    aria-valuenow={Math.round(c.percent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="dash-fin-bar-fill"
                      style={{
                        width: `${maxCategory > 0 ? (c.revenueNet / maxCategory) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
