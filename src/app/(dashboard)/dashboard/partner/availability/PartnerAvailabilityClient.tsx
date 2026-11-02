"use client";

// Διαθεσιμότητα για τον συνεργάτη: ελεύθερο / κατειλημμένο ανά όχημα και ημέρα
// (από το GET /api/partner/availability — κανένα στοιχείο κράτησης). Με το
// δικαίωμα «partner.book»: νέα κράτηση από ελεύθερο κελί (POST /api/partner/bookings,
// η τιμή υπολογίζεται ΜΟΝΟ στον server).

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import { formatMoney } from "@/lib/public/money";
import type { AvailabilityRow } from "@/lib/partnerAvailability";

type Grid = { days: string[]; vehicles: AvailabilityRow[] };

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const dayLabel = (iso: string, locale: string) =>
  new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(locale === "en" ? "en-GB" : "el-GR", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  });

export default function PartnerAvailabilityClient({
  today,
  days,
  initial,
  canBook,
}: {
  today: string;
  days: number;
  initial: Grid;
  canBook: boolean;
}) {
  const tr = useT();
  const locale = useLocale();
  const [from, setFrom] = useState(today);
  const [grid, setGrid] = useState<Grid>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState<{ vehicleId: string; date: string } | null>(null);
  const [reload, setReload] = useState(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/partner/availability?from=${from}&days=${days}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j.message);
        setGrid(j.data);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError(tr("partner.error"));
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [from, days, reload, tr]);

  return (
    <>
      <div className="dash-page-head dash-head-row">
        <div>
          <h1 className="dash-page-title">{tr("partner.availabilityTitle")}</h1>
          <p className="dash-page-sub">{tr("partner.availabilitySubtitle")}</p>
        </div>
        {canBook && (
          <button
            type="button"
            className="dash-btn dash-btn--primary"
            onClick={() => setBooking({ vehicleId: grid.vehicles[0]?.id ?? "", date: from < today ? today : from })}
            data-testid="partner-new-booking"
          >
            {tr("partner.newBooking")}
          </button>
        )}
      </div>

      <div className="dash-toolbar">
        <button type="button" className="dash-btn" onClick={() => setFrom(addDays(from, -7))}>
          ‹ {tr("partner.prev")}
        </button>
        <label className="dash-field dash-field--inline">
          {tr("partner.from")}
          <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <button type="button" className="dash-btn" onClick={() => setFrom(addDays(from, 7))}>
          {tr("partner.next")} ›
        </button>
        {loading && <span className="dash-count">{tr("partner.loading")}</span>}
      </div>
      {error && <div className="dash-form-error">{error}</div>}

      <div className="dash-pa-legend">
        <span className="dash-pa-cell is-free" aria-hidden /> {tr("partner.free")}
        <span className="dash-pa-cell is-busy" aria-hidden /> {tr("partner.busy")}
      </div>

      <div className="dash-panel dash-pa-wrap" data-testid="partner-availability">
        {grid.vehicles.length === 0 ? (
          <p className="dash-form-note">{tr("partner.noVehicles")}</p>
        ) : (
          <table className="dash-pa-table">
            <thead>
              <tr>
                <th scope="col" className="dash-pa-vehicle">{tr("partner.vehicle")}</th>
                {grid.days.map((d) => (
                  <th key={d} scope="col">{dayLabel(d, locale)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.vehicles.map((v) => (
                <tr key={v.id}>
                  <th scope="row" className="dash-pa-vehicle">{v.label}</th>
                  {v.free.map((free, i) => {
                    const label = `${v.label} · ${dayLabel(grid.days[i], locale)}: ${tr(free ? "partner.free" : "partner.busy")}`;
                    return (
                      <td key={grid.days[i]}>
                        {free && canBook ? (
                          <button
                            type="button"
                            className="dash-pa-cell is-free"
                            title={label}
                            aria-label={`${label} — ${tr("partner.newBooking")}`}
                            onClick={() => setBooking({ vehicleId: v.id, date: grid.days[i] })}
                            data-testid="pa-cell-free"
                          />
                        ) : (
                          <span
                            className={`dash-pa-cell ${free ? "is-free" : "is-busy"}`}
                            title={label}
                            role="img"
                            aria-label={label}
                            data-testid={free ? "pa-cell-free" : "pa-cell-busy"}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {booking && canBook && (
        <PartnerBookingModal
          vehicles={grid.vehicles}
          initial={booking}
          onClose={() => setBooking(null)}
          onDone={() => setReload((n) => n + 1)}
        />
      )}
    </>
  );
}

function PartnerBookingModal({
  vehicles,
  initial,
  onClose,
  onDone,
}: {
  vehicles: AvailabilityRow[];
  initial: { vehicleId: string; date: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const tr = useT();
  const locale = useLocale();
  const [form, setForm] = useState({
    vehicleId: initial.vehicleId,
    pickupDate: initial.date,
    pickupTime: "10:00",
    returnDate: addDays(initial.date, 1),
    returnTime: "10:00",
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    notes: "",
  });
  const [price, setPrice] = useState<{ totalCents: number; commissionCents: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    if (["vehicleId", "pickupDate", "pickupTime", "returnDate", "returnTime"].some((k) => k in patch)) setPrice(null);
  };

  const body = (preview: boolean) => ({
    vehicleId: form.vehicleId,
    pickupDate: form.pickupDate,
    pickupTime: form.pickupTime,
    returnDate: form.returnDate,
    returnTime: form.returnTime,
    notes: form.notes.trim() || null,
    ...(preview
      ? { preview: true }
      : { customer: { firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null } }),
  });

  const send = async (preview: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/partner/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body(preview)),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.message || tr("partner.error"));
        return;
      }
      if (preview) setPrice({ totalCents: j.data.totalCents, commissionCents: j.data.commissionCents });
      else {
        setDone(j.data.booking.bookingNumber);
        setPrice({ totalCents: j.data.booking.totalCents, commissionCents: j.data.booking.commissionCents });
        onDone();
      }
    } catch {
      setError(tr("partner.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal dash-pb-modal" role="dialog" aria-modal="true" aria-labelledby="pb-title" onClick={(e) => e.stopPropagation()} data-testid="partner-booking-modal">
        <div className="dash-modal-header">
          <h2 id="pb-title">{tr("partner.bookTitle")}</h2>
          <button className="dash-modal-close" onClick={onClose} aria-label={tr("partner.cancel")}>
            <X size={18} />
          </button>
        </div>
        <div className="dash-modal-body">
          {done ? (
            <p className="dash-form-note" role="status" data-testid="partner-booking-done">
              {tr("partner.done").replace("{number}", done)}
            </p>
          ) : (
            <div className="dash-form-grid">
              <label className="dash-field dash-field--wide">
                {tr("partner.vehicle")}
                <select value={form.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })}>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </label>
              <label className="dash-field">
                {tr("partner.pickup")}
                <input type="date" value={form.pickupDate} onChange={(e) => set({ pickupDate: e.target.value })} />
              </label>
              <label className="dash-field">
                &nbsp;
                <input type="time" value={form.pickupTime} onChange={(e) => set({ pickupTime: e.target.value })} aria-label={tr("partner.pickup")} />
              </label>
              <label className="dash-field">
                {tr("partner.return")}
                <input type="date" value={form.returnDate} min={form.pickupDate} onChange={(e) => set({ returnDate: e.target.value })} />
              </label>
              <label className="dash-field">
                &nbsp;
                <input type="time" value={form.returnTime} onChange={(e) => set({ returnTime: e.target.value })} aria-label={tr("partner.return")} />
              </label>
              <label className="dash-field">
                {tr("partner.firstName")}
                <input value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} autoComplete="off" data-testid="pb-first" />
              </label>
              <label className="dash-field">
                {tr("partner.lastName")}
                <input value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} autoComplete="off" data-testid="pb-last" />
              </label>
              <label className="dash-field">
                {tr("partner.phone")}
                <input type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} autoComplete="off" />
              </label>
              <label className="dash-field">
                {tr("partner.email")}
                <input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} autoComplete="off" />
              </label>
              <label className="dash-field dash-field--wide">
                {tr("partner.notes")}
                <textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
              </label>
            </div>
          )}
          {price && (
            <dl className="dash-pb-price" data-testid="partner-booking-price">
              <dt>{tr("partner.price")}</dt>
              <dd data-testid="pb-total">{formatMoney(price.totalCents, locale)}</dd>
              <dt>{tr("partner.yourCommission")}</dt>
              <dd data-testid="pb-commission">{formatMoney(price.commissionCents, locale)}</dd>
            </dl>
          )}
          {!done && <p className="dash-form-note">{tr("partner.priceNote")}</p>}
          {error && <div className="dash-form-error" role="alert">{error}</div>}
        </div>
        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose}>{tr("partner.cancel")}</button>
          {!done && (
            <>
              <button className="dash-btn" onClick={() => send(true)} disabled={busy} data-testid="pb-preview">
                {tr("partner.checkPrice")}
              </button>
              <button
                className="dash-btn dash-btn--primary"
                onClick={() => send(false)}
                disabled={busy || !price || !form.firstName.trim() || !form.lastName.trim()}
                data-testid="pb-submit"
              >
                {busy ? tr("partner.submitting") : tr("partner.submit")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
