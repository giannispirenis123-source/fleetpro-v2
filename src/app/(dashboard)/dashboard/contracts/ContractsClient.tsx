"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileSignature, Car, Search } from "lucide-react";
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

export default function ContractsClient({
  initialContracts,
}: {
  initialContracts: ContractListItem[];
}) {
  const tr = useT();
  const locale = useLocale();

  const [filter, setFilter] = useState<Filter>("ALL");
  const [q, setQ] = useState("");
  const [contracts, setContracts] = useState(initialContracts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const seq = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const mine = ++seq.current;
    // Μικρή καθυστέρηση ώστε η αναζήτηση να μη ρωτά σε κάθε πλήκτρο.
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (filter !== "ALL") params.set("status", filter);
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`/api/contracts?${params}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (mine !== seq.current) return;
        if (!res.ok) {
          setError(data.message || tr("contracts.errorLoad"));
          return;
        }
        setContracts(data.data.contracts);
      } catch {
        if (mine === seq.current) setError(tr("contracts.errorConnection"));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [filter, q, tr]);

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{tr("contracts.title")}</h1>
        <p className="dash-page-sub">{tr("contracts.subtitle")}</p>
      </div>

      <div className="dash-toolbar">
        <div className="dash-filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`dash-filter ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
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
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        {loading && <span className="dash-count">{tr("contracts.loading")}</span>}
      </div>

      <p className="dash-form-note">{tr("contracts.howToCreate")}</p>
      {error && <div className="dash-form-error">{error}</div>}

      {contracts.length === 0 ? (
        <div className="dash-panel dash-empty">{tr("contracts.empty")}</div>
      ) : (
        <div className="dash-invoices">
          {contracts.map((c) => (
            <Link key={c.id} href={`/dashboard/contracts/${c.id}`} className="dash-invoice dash-contract-row">
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
                  {c.bookingNumber} · {shortDate(c.pickupDate, locale)} → {shortDate(c.returnDate, locale)}
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
    </>
  );
}
