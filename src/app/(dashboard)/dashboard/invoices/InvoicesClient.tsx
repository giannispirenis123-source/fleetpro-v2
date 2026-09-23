"use client";

import { useMemo, useState } from "react";
import {
  Search,
  Receipt,
  Printer,
  Check,
  X,
  Undo2,
  FileText,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  INVOICE_STATUS_CLASS,
  effectiveStatus,
  type InvoiceDTO,
} from "@/lib/invoices";

const INTL_LOCALE: Record<string, string> = { el: "el-GR", en: "en-GB" };

const eur = (n: number, locale: string) =>
  new Intl.NumberFormat(INTL_LOCALE[locale] ?? "el-GR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

const shortDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? "el-GR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00.000Z`));

export interface CompanyInfo {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  vat: string | null;
  iban: string | null;
}

type Filter = "ALL" | "UNPAID" | "PAID" | "OVERDUE";
const FILTERS: Filter[] = ["ALL", "UNPAID", "PAID", "OVERDUE"];

export default function InvoicesClient({
  initialInvoices,
  company,
}: {
  initialInvoices: InvoiceDTO[];
  company: CompanyInfo;
}) {
  const tr = useT();
  const locale = useLocale();

  const [invoices, setInvoices] = useState<InvoiceDTO[]>(initialInvoices);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [open, setOpen] = useState<InvoiceDTO | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((i) => {
      const state = effectiveStatus(i);
      const matchesFilter =
        filter === "ALL" ||
        (filter === "UNPAID"
          ? state === "UNPAID" || state === "OVERDUE"
          : state === filter);
      const matchesSearch =
        !q ||
        [i.invoiceNumber, i.customerName, i.bookingNumber]
          .join(" ")
          .toLowerCase()
          .includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [invoices, search, filter]);

  const setPaid = async (invoice: InvoiceDTO, paid: boolean) => {
    if (busyId) return;

    setBusyId(invoice.id);
    setError("");

    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: paid ? "PAID" : "UNPAID" }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || tr("invoices.errorSave"));
        return;
      }

      const next: InvoiceDTO = data.data.invoice;
      setInvoices((prev) => prev.map((x) => (x.id === next.id ? next : x)));
      setOpen((current) => (current && current.id === next.id ? next : current));
    } catch {
      setError(tr("invoices.errorConnection"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{tr("invoices.title")}</h1>
        <p className="dash-page-sub">{tr("invoices.subtitle")}</p>
      </div>

      <div className="dash-toolbar">
        <div className="dash-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("invoices.searchPlaceholder")}
          />
        </div>
        <div className="dash-filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`dash-filter ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
            >
              {tr(`invoices.filter${f}`)}
            </button>
          ))}
        </div>
        <span className="dash-count">
          {visible.length}{" "}
          {visible.length === 1
            ? tr("invoices.countOne")
            : tr("invoices.count")}
        </span>
      </div>

      {error && <div className="dash-form-error">{error}</div>}

      {visible.length === 0 ? (
        <div className="dash-panel dash-empty">
          {invoices.length === 0 ? (
            <>
              {tr("invoices.empty")}
              <br />
              <small>{tr("invoices.emptyHint")}</small>
            </>
          ) : (
            tr("invoices.emptyFiltered")
          )}
        </div>
      ) : (
        <div className="dash-invoices">
          {visible.map((i) => (
            <InvoiceRow
              key={i.id}
              invoice={i}
              locale={locale}
              tr={tr}
              busy={busyId === i.id}
              onOpen={() => setOpen(i)}
              onPaid={() => setPaid(i, true)}
            />
          ))}
        </div>
      )}

      {open && (
        <InvoiceDetail
          invoice={open}
          company={company}
          locale={locale}
          tr={tr}
          busy={busyId === open.id}
          onClose={() => setOpen(null)}
          onTogglePaid={(paid) => setPaid(open, paid)}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Γραμμή λίστας
   ───────────────────────────────────────────── */

function InvoiceRow({
  invoice,
  locale,
  tr,
  busy,
  onOpen,
  onPaid,
}: {
  invoice: InvoiceDTO;
  locale: string;
  tr: (key: string) => string;
  busy: boolean;
  onOpen: () => void;
  onPaid: () => void;
}) {
  const state = effectiveStatus(invoice);

  return (
    <div className="dash-invoice">
      <div className="dash-invoice-id">
        <span className="dash-invoice-number">
          <Receipt size={15} /> {invoice.invoiceNumber}
        </span>
        <span
          className={`dash-status dash-status--${
            INVOICE_STATUS_CLASS[state] ?? "muted"
          }`}
        >
          {tr(`invoices.status${state}`)}
        </span>
      </div>

      <div className="dash-invoice-who">
        <span className="dash-invoice-customer">{invoice.customerName}</span>
        <span className="dash-invoice-booking">
          {tr("invoices.booking")} {invoice.bookingNumber} ·{" "}
          {shortDate(invoice.issueDate, locale)}
        </span>
      </div>

      <div className="dash-invoice-money">
        <span className="dash-invoice-line">
          {tr("invoices.net")} <strong>{eur(invoice.net, locale)}</strong>
        </span>
        <span className="dash-invoice-line">
          {tr("invoices.vat")} {invoice.vatRate}%{" "}
          <strong>{eur(invoice.vatAmount, locale)}</strong>
        </span>
        <span className="dash-invoice-total">{eur(invoice.total, locale)}</span>
      </div>

      <div className="dash-invoice-actions">
        {state !== "PAID" && state !== "CANCELLED" && (
          <button
            className="dash-btn dash-btn--primary"
            onClick={onPaid}
            disabled={busy}
          >
            <Check size={16} />{" "}
            {busy ? tr("invoices.marking") : tr("invoices.markPaid")}
          </button>
        )}
        <button className="dash-btn" onClick={onOpen}>
          <FileText size={16} /> {tr("invoices.details")}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Λεπτομέρειες + εκτύπωση
   ───────────────────────────────────────────── */

function InvoiceDetail({
  invoice,
  company,
  locale,
  tr,
  busy,
  onClose,
  onTogglePaid,
}: {
  invoice: InvoiceDTO;
  company: CompanyInfo;
  locale: string;
  tr: (key: string) => string;
  busy: boolean;
  onClose: () => void;
  onTogglePaid: (paid: boolean) => void;
}) {
  const state = effectiveStatus(invoice);
  const paid = invoice.status === "PAID";

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>
            {tr("invoices.detailTitle")} {invoice.invoiceNumber}
          </h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("invoices.close")}
          >
            <X size={18} />
          </button>
        </div>

        {/* Ό,τι βρίσκεται εδώ μέσα είναι και η εκτυπώσιμη μορφή. */}
        <div className="dash-modal-body dash-print-area">
          <div className="dash-inv-doc">
            <div className="dash-inv-head">
              <div>
                <div className="dash-inv-title">
                  {tr("invoices.detailTitle")}
                </div>
                <div className="dash-inv-number">{invoice.invoiceNumber}</div>
              </div>
              <div className="dash-inv-dates">
                <div>
                  {tr("invoices.issueDate")}:{" "}
                  <strong>{shortDate(invoice.issueDate, locale)}</strong>
                </div>
                <div>
                  {tr("invoices.dueDate")}:{" "}
                  <strong>{shortDate(invoice.dueDate, locale)}</strong>
                </div>
                <div>
                  <span
                    className={`dash-status dash-status--${
                      INVOICE_STATUS_CLASS[state] ?? "muted"
                    }`}
                  >
                    {tr(`invoices.status${state}`)}
                  </span>
                </div>
              </div>
            </div>

            <div className="dash-inv-parties">
              <div className="dash-inv-party">
                <h3>{tr("invoices.issuer")}</h3>
                <div className="dash-inv-party-name">{company.name}</div>
                {company.address && <div>{company.address}</div>}
                {company.vat && (
                  <div>
                    {tr("invoices.vatNumber")}: {company.vat}
                  </div>
                )}
                {company.phone && (
                  <div>
                    {tr("invoices.phone")}: {company.phone}
                  </div>
                )}
                {company.email && <div>{company.email}</div>}
                {company.iban && (
                  <div>
                    {tr("invoices.iban")}: {company.iban}
                  </div>
                )}
              </div>

              <div className="dash-inv-party">
                <h3>{tr("invoices.recipient")}</h3>
                <div className="dash-inv-party-name">
                  {invoice.customerName}
                </div>
                <div>{invoice.customerAddress ?? tr("invoices.noAddress")}</div>
                {invoice.customerEmail && <div>{invoice.customerEmail}</div>}
                <div>
                  {tr("invoices.booking")}: {invoice.bookingNumber}
                </div>
              </div>
            </div>

            <div className="dash-breakdown dash-inv-breakdown">
              <div className="dash-price-row">
                <span>{tr("invoices.net")}</span>
                <span>{eur(invoice.net, locale)}</span>
              </div>
              <div className="dash-price-row">
                <span>
                  {tr("invoices.vat")} {invoice.vatRate}%
                </span>
                <span>{eur(invoice.vatAmount, locale)}</span>
              </div>
              <div className="dash-price-row total">
                <span>{tr("invoices.total")}</span>
                <span>{eur(invoice.total, locale)}</span>
              </div>
            </div>

            {invoice.paidAt && (
              <p className="dash-form-note">
                {tr("invoices.paidAt")}:{" "}
                <strong>{shortDate(invoice.paidAt, locale)}</strong>
              </p>
            )}

            <p className="dash-form-note dash-inv-foot">
              {tr("invoices.vatNote")} {tr("invoices.printedNote")}
            </p>
          </div>
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose}>
            {tr("invoices.close")}
          </button>
          <button className="dash-btn" onClick={() => window.print()}>
            <Printer size={16} /> {tr("invoices.print")}
          </button>
          {state !== "CANCELLED" &&
            (paid ? (
              <button
                className="dash-btn"
                onClick={() => onTogglePaid(false)}
                disabled={busy}
              >
                <Undo2 size={16} />{" "}
                {busy ? tr("invoices.marking") : tr("invoices.markUnpaid")}
              </button>
            ) : (
              <button
                className="dash-btn dash-btn--primary"
                onClick={() => onTogglePaid(true)}
                disabled={busy}
              >
                <Check size={16} />{" "}
                {busy ? tr("invoices.marking") : tr("invoices.markPaid")}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
