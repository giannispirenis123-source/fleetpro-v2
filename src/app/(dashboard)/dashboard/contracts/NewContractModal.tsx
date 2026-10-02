"use client";

// «Από υπάρχουσα κράτηση»: διάλεξε κράτηση χωρίς συμβόλαιο. Το ίδιο
// POST /api/contracts με το κουμπί «Συμβόλαιο» της κράτησης. Το ανοίγουν
// η λίστα Συμβολαίων και η φόρμα «Νέο συμβόλαιο».

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Car, Search, X } from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";

const INTL: Record<string, string> = { el: "el-GR", en: "en-GB" };

const shortDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(INTL[locale] ?? "el-GR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00.000Z`));

interface BookingOption {
  id: string;
  bookingNumber: string;
  status: string;
  customerName: string;
  vehicleLabel: string;
  pickupDate: string;
  returnDate: string;
}

/* ─────────────────────────────────────────────
   «+ Νέο συμβόλαιο»: διάλεξε κράτηση χωρίς συμβόλαιο
   ───────────────────────────────────────────── */

export default function NewContractModal({ onClose }: { onClose: () => void }) {
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
