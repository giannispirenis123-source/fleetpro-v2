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

type Mode = "month" | "days" | "all";

/** Ίδιος έλεγχος με τον server (parsePeriod) για άμεσο μήνυμα — ο server αποφασίζει. */
const daysValid = (from: string, to: string) => {
  const ok = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  if (!ok(from) || !ok(to) || from > to) return false;
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1 <= 366;
};

export default function PartnerCommissionsClient({ initialMonth, initial }: { initialMonth: string; initial: Overview }) {
  const tr = useT();
  const locale = useLocale();
  const [mode, setMode] = useState<Mode>("month");
  const [month, setMonth] = useState(initialMonth);
  const [days, setDays] = useState({ from: `${initialMonth}-01`, to: `${initialMonth}-01` });
  const [pdfScope, setPdfScope] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [data, setData] = useState<Overview>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<PartnerLine | null>(null);
  const first = useRef(true);
  const money = (c: number) => formatMoney(c, locale);
  // ΤΟ ενεργό φίλτρο ως query — το ίδιο πάει στη λίστα, στη λεπτομέρεια και στο PDF.
  const daysOk = mode !== "days" || daysValid(days.from, days.to);
  const query =
    mode === "days"
      ? new URLSearchParams({ from: days.from, to: days.to }).toString()
      : mode === "month" && month
        ? new URLSearchParams({ month }).toString()
        : "";

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!daysOk) {
      setError(tr("partnerCommissions.invalidDays"));
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/partner-commissions?${query}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw Object.assign(new Error(j.message), { server: j.message });
        setData({ partners: j.data.partners, totals: j.data.totals });
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError(e?.server || tr("partner.error"));
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [query, daysOk, tr]);

  /** PDF από τον server με ΤΟ ίδιο φίλτρο· λήψη ως αρχείο με το όνομα που δίνει ο server. */
  const downloadPdf = async () => {
    if (pdfBusy || !daysOk) return;
    setPdfBusy(true);
    setError("");
    try {
      const params = new URLSearchParams(query);
      if (pdfScope) params.set("partner", pdfScope);
      const res = await fetch(`/api/partner-commissions/pdf?${params}`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.message || tr("partnerCommissions.pdfError"));
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "promitheies.pdf";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError(tr("partnerCommissions.pdfError"));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{tr("partnerCommissions.title")}</h1>
        <p className="dash-page-sub">{tr("partnerCommissions.subtitle")}</p>
      </div>

      <div className="dash-toolbar dash-pc-toolbar">
        <div className="dash-filters" role="group" aria-label={tr("partnerCommissions.pdfPeriod")}>
          {(["month", "days", "all"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`dash-filter ${mode === m ? "active" : ""}`}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              data-testid={`pc-mode-${m}`}
            >
              {tr(m === "month" ? "partnerCommissions.filterMonth" : m === "days" ? "partnerCommissions.filterDays" : "partner.allMonths")}
            </button>
          ))}
        </div>
        {mode === "month" && (
          <label className="dash-field dash-field--inline">
            {tr("partner.month")}
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="pc-month" />
          </label>
        )}
        {mode === "days" && (
          <>
            <label className="dash-field dash-field--inline">
              {tr("partnerCommissions.from")}
              <input type="date" value={days.from} max={days.to || undefined} onChange={(e) => setDays((d) => ({ ...d, from: e.target.value }))} data-testid="pc-from" />
            </label>
            <label className="dash-field dash-field--inline">
              {tr("partnerCommissions.to")}
              <input type="date" value={days.to} min={days.from || undefined} onChange={(e) => setDays((d) => ({ ...d, to: e.target.value }))} data-testid="pc-to" />
            </label>
          </>
        )}
        {loading && <span className="dash-count">{tr("partner.loading")}</span>}
      </div>

      <div className="dash-toolbar dash-pc-toolbar">
        <label className="dash-field dash-field--inline">
          {tr("partnerCommissions.pdfScope")}
          <select value={pdfScope} onChange={(e) => setPdfScope(e.target.value)} data-testid="pc-pdf-scope">
            <option value="">{tr("partnerCommissions.pdfAll")}</option>
            {data.partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="dash-btn dash-btn--primary" onClick={downloadPdf} disabled={pdfBusy || !daysOk} data-testid="pc-pdf">
          {pdfBusy ? tr("partnerCommissions.pdfDownloading") : tr("partnerCommissions.printPdf")}
        </button>
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

      {open && <PartnerDetailModal partner={open} query={query} onClose={() => setOpen(null)} />}
    </>
  );
}

function PartnerDetailModal({ partner, query, onClose }: { partner: PartnerLine; query: string; onClose: () => void }) {
  const tr = useT();
  const locale = useLocale();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/partner-commissions/${encodeURIComponent(partner.id)}?${query}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j.message);
        setDetail(j.data);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError(tr("partner.error"));
      });
    return () => ctrl.abort();
  }, [partner.id, query, tr]);

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
