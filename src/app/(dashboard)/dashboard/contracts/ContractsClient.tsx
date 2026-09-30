"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSignature, Car, Search, Plus, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  CONTRACT_STATUSES,
  CONTRACT_STATUS_CLASS,
  type ContractListItem,
} from "@/lib/contracts";

const INTL: Record<string, string> = { el: "el-GR", en: "en-GB" };

const shortDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(INTL[locale] ?? "el-GR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00.000Z`));

type Filter = "ALL" | (typeof CONTRACT_STATUSES)[number];
const FILTERS: Filter[] = ["ALL", ...CONTRACT_STATUSES];

interface ListPage {
  contracts: ContractListItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface BookingOption {
  id: string;
  bookingNumber: string;
  status: string;
  customerName: string;
  vehicleLabel: string;
  pickupDate: string;
  returnDate: string;
}

export default function ContractsClient({
  initialPage,
  canCreate,
}: {
  initialPage: ListPage;
  canCreate: boolean;
}) {
  const tr = useT();
  const locale = useLocale();

  const [filter, setFilter] = useState<Filter>("ALL");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListPage>(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const seq = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const mine = ++seq.current;
    // Debounce: η αναζήτηση δεν ρωτά τον server σε κάθε πλήκτρο.
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (filter !== "ALL") params.set("status", filter);
        if (q.trim()) params.set("q", q.trim());
        params.set("page", String(page));
        const res = await fetch(`/api/contracts?${params}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (mine !== seq.current) return;
        if (!res.ok) {
          setError(body.message || tr("contracts.errorLoad"));
          return;
        }
        setData(body.data);
      } catch {
        if (mine === seq.current) setError(tr("contracts.errorConnection"));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [filter, q, page, tr]);

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <>
      <div className="dash-page-head dash-head-row">
        <div>
          <h1 className="dash-page-title">{tr("contracts.title")}</h1>
          <p className="dash-page-sub">{tr("contracts.subtitle")}</p>
        </div>
        {canCreate && (
          <button className="dash-btn dash-btn--primary" onClick={() => setCreating(true)}>
            <Plus size={17} /> {tr("contracts.newContract")}
          </button>
        )}
      </div>

      <div className="dash-toolbar">
        <div className="dash-filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`dash-filter ${filter === f ? "active" : ""}`}
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
              aria-pressed={filter === f}
            >
              {f === "ALL" ? tr("contracts.all") : tr(`contracts.status_${f}`)}
            </button>
          ))}
        </div>
        <label className="dash-field dash-field--inline dash-contract-search">
          <Search size={15} />
          <input
            value={q}
            placeholder={tr("contracts.search")}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <span className="dash-count">
          {loading ? tr("contracts.loading") : `${data.total} ${tr("contracts.results")}`}
        </span>
      </div>

      <p className="dash-form-note">{tr("contracts.searchHelp")}</p>
      {error && <div className="dash-form-error">{error}</div>}

      {data.contracts.length === 0 ? (
        <div className="dash-panel dash-empty">
          {q.trim() || filter !== "ALL" ? tr("contracts.noResults") : tr("contracts.empty")}
        </div>
      ) : (
        <div className="dash-invoices">
          {data.contracts.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/contracts/${c.id}`}
              className="dash-invoice dash-contract-row"
            >
              <div className="dash-invoice-id">
                <span className="dash-invoice-number">
                  <FileSignature size={15} /> {c.contractNumber}
                </span>
                <span className={`dash-status dash-status--${CONTRACT_STATUS_CLASS[c.status]}`}>
                  {tr(`contracts.status_${c.status}`)}
                </span>
              </div>
              <div className="dash-invoice-who">
                <span className="dash-invoice-customer">{c.customerName}</span>
                <span className="dash-invoice-booking">
                  <Car size={12} /> {c.vehicleLabel}
                </span>
                <span className="dash-invoice-booking">
                  {c.bookingNumber} · {shortDate(c.pickupDate, locale)} →{" "}
                  {shortDate(c.returnDate, locale)}
                </span>
              </div>
              <div className="dash-invoice-money">
                <span className="dash-invoice-total">
                  {c.signedDrivers}/{c.drivers}
                </span>
                <span className="dash-invoice-booking">{tr("contracts.signaturesShort")}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="dash-pager">
          <button
            className="dash-btn"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label={tr("contracts.prevPage")}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="dash-count">
            {tr("contracts.page")} {data.page} / {pages}
          </span>
          <button
            className="dash-btn"
            disabled={page >= pages || loading}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            aria-label={tr("contracts.nextPage")}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {creating && <NewContractModal onClose={() => setCreating(false)} />}
    </>
  );
}

/* ─────────────────────────────────────────────
   «+ Νέο συμβόλαιο»: διάλεξε κράτηση χωρίς συμβόλαιο
   ───────────────────────────────────────────── */

function NewContractModal({ onClose }: { onClose: () => void }) {
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();

  const [q, setQ] = useState("");
  const [bookings, setBookings] = useState<BookingOption[] | null>(null);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const params = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
        const res = await fetch(`/api/contracts/bookings${params}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (mine !== seq.current) return;
        if (!res.ok) {
          setError(body.message || tr("contracts.errorLoad"));
          return;
        }
        setError("");
        setBookings(body.data.bookings);
      } catch {
        if (mine === seq.current) setError(tr("contracts.errorConnection"));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, tr]);

  // Η ίδια λογική με το κουμπί «Συμβόλαιο» της κράτησης: το POST επιστρέφει
  // το υπάρχον ή φτιάχνει νέο, και ανοίγει η φόρμα.
  const open = async (bookingId: string) => {
    if (opening) return;
    setOpening(bookingId);
    setError("");
    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.message || tr("contracts.errorSave"));
        return;
      }
      router.push(`/dashboard/contracts/${body.data.id}`);
    } catch {
      setError(tr("contracts.errorConnection"));
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>{tr("contracts.newContractTitle")}</h2>
          <button className="dash-icon-btn" onClick={onClose} aria-label={tr("contracts.cancel")}>
            <X size={18} />
          </button>
        </div>
        <div className="dash-modal-body">
          <label className="dash-field dash-contract-search">
            <Search size={15} />
            <input
              autoFocus
              value={q}
              placeholder={tr("contracts.bookingSearch")}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <p className="dash-form-note">{tr("contracts.newContractHelp")}</p>
          {error && <div className="dash-form-error">{error}</div>}

          {bookings === null ? (
            <p className="dash-form-note">{tr("contracts.loading")}</p>
          ) : bookings.length === 0 ? (
            <p className="dash-form-note">{tr("contracts.noBookingsWithout")}</p>
          ) : (
            <div className="dash-pick-list">
              {bookings.map((b) => (
                <button
                  key={b.id}
                  className="dash-pick"
                  disabled={opening !== null}
                  onClick={() => open(b.id)}
                >
                  <span className="dash-pick-main">
                    <strong>{b.bookingNumber}</strong> · {b.customerName}
                  </span>
                  <span className="dash-pick-sub">
                    <Car size={12} /> {b.vehicleLabel}
                  </span>
                  <span className="dash-pick-sub">
                    {shortDate(b.pickupDate, locale)} → {shortDate(b.returnDate, locale)} ·{" "}
                    {tr(`status.${b.status}`)}
                  </span>
                  {opening === b.id && (
                    <span className="dash-pick-sub">{tr("contracts.opening")}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
