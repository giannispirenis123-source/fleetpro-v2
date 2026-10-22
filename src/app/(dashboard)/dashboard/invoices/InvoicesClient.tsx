"use client";

import { useState } from "react";
import Pager from "@/components/lists/Pager";
import { useServerList } from "@/components/lists/useServerList";
import type { ListPage } from "@/lib/pagination";
import {
  Search,
  Receipt,
  Printer,
  Check,
  X,
  Undo2,
  FileText,
  Download,
  Mail,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  INVOICE_STATUS_CLASS,
  effectiveStatus,
  type InvoiceDTO,
} from "@/lib/invoices";
import { invoicePdfFilename, type DocLang } from "@/lib/invoiceDocument";
import { isEmail } from "@/lib/contractEmail";

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

/** Ημερομηνία + ώρα Ελλάδας, π.χ. «11/10/26, 14:05». */
const stamp = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(INTL_LOCALE[locale] ?? "el-GR", {
    timeZone: "Europe/Athens",
    dateStyle: "short",
    timeStyle: "short",
  });

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

/** Λήψη PDF / αποστολή στον πελάτη — κοινά για τη λίστα και τις λεπτομέρειες. */
interface DocActions {
  enabled: boolean;
  lang: DocLang;
  setLang: (l: DocLang) => void;
  busy: { id: string; kind: "pdf" | "email" } | null;
  download: (i: InvoiceDTO) => void;
  send: (i: InvoiceDTO) => void;
}

export default function InvoicesClient({
  initialPage,
  company,
  canExport = false,
}: {
  initialPage: ListPage<InvoiceDTO>;
  company: CompanyInfo;
  canExport?: boolean;
}) {
  const tr = useT();
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  // Σελίδες των 50 στον server· φίλτρο (ίδιο νόημα με το effectiveStatus) και
  // αναζήτηση στον server, πάνω σε ΟΛΑ τα τιμολόγια.
  const list = useServerList("/api/invoices", initialPage, { filter: filter === "ALL" ? "" : filter, q: search.trim() }, {
    load: tr("contracts.errorLoad"),
    connection: tr("invoices.errorConnection"),
  });
  const visible = list.data.items;
  const setInvoices = (fn: (prev: InvoiceDTO[]) => InvoiceDTO[]) => list.setData((d) => ({ ...d, items: fn(d.items) }));
  const [open, setOpen] = useState<InvoiceDTO | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Γλώσσα του EMAIL (θέμα + κείμενο), προεπιλογή Ελληνικά. Το PDF είναι
  // πάντα δίγλωσσο και δεν εξαρτάται από αυτήν.
  const [docLang, setDocLang] = useState<DocLang>("el");
  const [docBusy, setDocBusy] = useState<DocActions["busy"]>(null);

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
      // Πληρώθηκε/ξεπληρώθηκε: με φίλτρο μπορεί να βγει από τη λίστα — ξανά από τον server.
      if (filter !== "ALL") list.reload();
    } catch {
      setError(tr("invoices.errorConnection"));
    } finally {
      setBusyId(null);
    }
  };

  const replace = (next: InvoiceDTO) => {
    setInvoices((prev) => prev.map((x) => (x.id === next.id ? next : x)));
    setOpen((current) => (current && current.id === next.id ? next : current));
  };

  const download = async (invoice: InvoiceDTO) => {
    if (docBusy) return;
    setDocBusy({ id: invoice.id, kind: "pdf" });
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/pdf`, { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || tr("invoices.errorPdf"));
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = invoicePdfFilename(invoice.invoiceCode);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError(tr("invoices.errorConnection"));
    } finally {
      setDocBusy(null);
    }
  };

  const send = async (invoice: InvoiceDTO) => {
    if (docBusy) return;
    if (!isEmail(invoice.customerEmail)) {
      setError(tr("invoices.emailMissing"));
      return;
    }
    setDocBusy({ id: invoice.id, kind: "email" });
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: docLang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("invoices.errorSend"));
        return;
      }
      const { sentAt, sentTo } = data.data as { sentAt: string; sentTo: string };
      replace({ ...invoice, sentAt, emailSentAt: sentAt, emailSentTo: sentTo });
      setNotice(`${tr("invoices.emailSentTo")} ${sentTo} ${tr("invoices.emailSentAt")} ${stamp(sentAt, locale)}`);
    } catch {
      setError(tr("invoices.errorConnection"));
    } finally {
      setDocBusy(null);
    }
  };

  const docActions: DocActions = {
    enabled: canExport,
    lang: docLang,
    setLang: setDocLang,
    busy: docBusy,
    download,
    send,
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
          {list.data.total}{" "}
          {list.data.total === 1
            ? tr("invoices.countOne")
            : tr("invoices.count")}
        </span>
      </div>

      {error && <div className="dash-form-error">{error}</div>}
      {notice && <div className="dash-alert-ok">{notice}</div>}

      {visible.length === 0 ? (
        <div className="dash-panel dash-empty">
          {filter === "ALL" && !search.trim() ? (
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
              doc={docActions}
            />
          ))}
        </div>
      )}

      {list.error && <div className="dash-form-error">{list.error}</div>}
      <Pager page={list.data.page} total={list.data.total} pageSize={list.data.pageSize} loading={list.loading} onPage={list.setPage} />

      {open && (
        <InvoiceDetail
          invoice={open}
          company={company}
          locale={locale}
          tr={tr}
          busy={busyId === open.id}
          onClose={() => setOpen(null)}
          onTogglePaid={(paid) => setPaid(open, paid)}
          doc={docActions}
          error={error}
          notice={notice}
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
  doc,
}: {
  invoice: InvoiceDTO;
  locale: string;
  tr: (key: string) => string;
  busy: boolean;
  onOpen: () => void;
  onPaid: () => void;
  doc: DocActions;
}) {
  const state = effectiveStatus(invoice);

  return (
    <div className="dash-invoice">
      <div className="dash-invoice-id">
        <span className="dash-invoice-number">
          <Receipt size={15} /> {invoice.invoiceCode}
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
        <DocButtons invoice={invoice} doc={doc} tr={tr} />
      </div>
      {invoice.emailSentAt && invoice.emailSentTo && (
        <div className="dash-invoice-sent">
          <Mail size={13} /> {tr("invoices.emailSentTo")} {invoice.emailSentTo}{" "}
          {tr("invoices.emailSentAt")} {stamp(invoice.emailSentAt, locale)}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   «Λήψη PDF» / «Αποστολή στον πελάτη» + γλώσσα
   ───────────────────────────────────────────── */

function DocButtons({
  invoice,
  doc,
  tr,
}: {
  invoice: InvoiceDTO;
  doc: DocActions;
  tr: (key: string) => string;
}) {
  if (!doc.enabled) return null;
  const mine = doc.busy?.id === invoice.id ? doc.busy.kind : null;
  const noEmail = !isEmail(invoice.customerEmail);
  const cancelled = invoice.status === "CANCELLED";

  return (
    <>
      <button
        type="button"
        className="dash-btn"
        onClick={() => doc.download(invoice)}
        disabled={Boolean(doc.busy)}
      >
        <Download size={16} /> {mine === "pdf" ? tr("invoices.downloading") : tr("invoices.downloadPdf")}
      </button>
      <button
        type="button"
        className="dash-btn"
        onClick={() => doc.send(invoice)}
        disabled={Boolean(doc.busy) || noEmail || cancelled}
        title={noEmail ? tr("invoices.emailMissing") : undefined}
      >
        <Mail size={16} />{" "}
        {mine === "email"
          ? tr("invoices.sending")
          : invoice.emailSentAt
            ? tr("invoices.resendEmail")
            : tr("invoices.sendEmail")}
      </button>
      <label className="dash-field dash-field--inline dash-doc-lang">
        <span>{tr("invoices.docLang")}</span>
        <select
          aria-label={tr("invoices.docLang")}
          value={doc.lang}
          disabled={Boolean(doc.busy)}
          onChange={(e) => doc.setLang(e.target.value === "en" ? "en" : "el")}
        >
          <option value="el">{tr("invoices.docLang_el")}</option>
          <option value="en">{tr("invoices.docLang_en")}</option>
        </select>
      </label>
    </>
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
  doc,
  error,
  notice,
}: {
  invoice: InvoiceDTO;
  company: CompanyInfo;
  locale: string;
  tr: (key: string) => string;
  busy: boolean;
  onClose: () => void;
  onTogglePaid: (paid: boolean) => void;
  doc: DocActions;
  error: string;
  notice: string;
}) {
  const state = effectiveStatus(invoice);
  const paid = invoice.status === "PAID";

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>
            {tr("invoices.detailTitle")} {invoice.invoiceCode}
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
                <div className="dash-inv-number">{invoice.invoiceCode}</div>
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

        {(doc.enabled || error || notice) && (
          <div className="dash-inv-docbar">
            {doc.enabled && (
              <div className="dash-inv-docbar-actions">
                <DocButtons invoice={invoice} doc={doc} tr={tr} />
              </div>
            )}
            {invoice.emailSentAt && invoice.emailSentTo && (
              <p className="dash-form-note">
                {tr("invoices.emailSentTo")} <strong>{invoice.emailSentTo}</strong>{" "}
                {tr("invoices.emailSentAt")} <strong>{stamp(invoice.emailSentAt, locale)}</strong>
              </p>
            )}
            {error && <div className="dash-form-error">{error}</div>}
            {notice && <div className="dash-alert-ok">{notice}</div>}
          </div>
        )}

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
