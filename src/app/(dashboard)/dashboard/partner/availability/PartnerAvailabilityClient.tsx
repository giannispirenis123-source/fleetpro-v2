"use client";

// Διαθεσιμότητα για τον συνεργάτη: ελεύθερο / κατειλημμένο ανά όχημα και ημέρα
// (από το GET /api/partner/availability — κανένα στοιχείο κράτησης). Με το
// δικαίωμα «partner.book»: νέα κράτηση από ελεύθερο κελί (POST /api/partner/bookings,
// η τιμή υπολογίζεται ΜΟΝΟ στον server).

import { useEffect, useRef, useState } from "react";
import { PackagePlus, ShieldCheck, X } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import { formatEuros, formatMoney } from "@/lib/public/money";
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
  extras = [],
}: {
  today: string;
  days: number;
  initial: Grid;
  canBook: boolean;
  /** Ενεργά πρόσθετα/ασφάλειες της εταιρίας (για τη φόρμα κράτησης). */
  extras?: ExtraOption[];
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
            onClick={() => setBooking({ vehicleId: "", date: from < today ? today : from })}
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
          extras={extras}
          initial={booking}
          onClose={() => setBooking(null)}
          onDone={() => setReload((n) => n + 1)}
        />
      )}
    </>
  );
}

type ExtraOption = { id: string; name: string; type: string; price: number; chargeType: string };
type Win = { pickupDate: string; pickupTime: string; returnDate: string; returnTime: string };
type VehicleOption = { id: string; label: string };

const windowValid = (w: Win) =>
  /^\d{4}-\d{2}-\d{2}$/.test(w.pickupDate) &&
  /^\d{4}-\d{2}-\d{2}$/.test(w.returnDate) &&
  /^\d{2}:\d{2}$/.test(w.pickupTime) &&
  /^\d{2}:\d{2}$/.test(w.returnTime) &&
  `${w.returnDate}T${w.returnTime}` > `${w.pickupDate}T${w.pickupTime}`;

/**
 * Νέα κράτηση συνεργάτη — ΙΔΙΑ ροή με τη φόρμα του προσωπικού (walk-in):
 * 1) παραλαβή/επιστροφή (ημερομηνίες + ώρες), 2) ΜΟΝΟ τα διαθέσιμα οχήματα του
 * διαστήματος (GET /api/partner/vehicles — ίδια λογική με το προσωπικό), 3)
 * πρόσθετα/ασφάλεια, πελάτης, σημειώσεις, 4) τιμή + προμήθεια από τον server.
 * Ο συνεργάτης δεν ορίζει τιμή/έκπτωση/κατάσταση και δεν παρακάμπτει σύγκρουση.
 */
function PartnerBookingModal({
  initial,
  extras,
  onClose,
  onDone,
}: {
  initial: { vehicleId: string; date: string };
  extras: ExtraOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const tr = useT();
  const locale = useLocale();
  const [win, setWin] = useState<Win>({
    pickupDate: initial.date,
    pickupTime: "10:00",
    returnDate: addDays(initial.date, 1),
    returnTime: "10:00",
  });
  const [vehicleId, setVehicleId] = useState(initial.vehicleId);
  const vehicleRef = useRef(vehicleId);
  vehicleRef.current = vehicleId;
  const [vehicles, setVehicles] = useState<VehicleOption[] | null>(null);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  /** Το όχημα που είχε επιλεγεί και δεν είναι πια διαθέσιμο (για το μήνυμα). */
  const [droppedVehicle, setDroppedVehicle] = useState(false);
  const [reloadVehicles, setReloadVehicles] = useState(0);
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [insuranceId, setInsuranceId] = useState("");
  const [customer, setCustomer] = useState({ firstName: "", lastName: "", phone: "", email: "", notes: "" });
  const [price, setPrice] = useState<{ totalCents: number; commissionCents: number } | null>(null);
  const [pricing, setPricing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const offeredExtras = extras.filter((e) => e.type === "EXTRA");
  const offeredInsurance = extras.filter((e) => e.type === "INSURANCE");
  const ok = windowValid(win);

  /* ── 2) Διαθέσιμα οχήματα για ΑΥΤΟ το διάστημα (ξαναφορτώνει σε κάθε αλλαγή) ── */
  const vehSeq = useRef(0);
  useEffect(() => {
    if (done) return;
    if (!ok) {
      setVehicles(null);
      return;
    }
    const mine = ++vehSeq.current;
    setLoadingVehicles(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams(win);
        const res = await fetch(`/api/partner/vehicles?${params}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (mine !== vehSeq.current) return;
        const list: VehicleOption[] = res.ok ? body.data.vehicles : [];
        setVehicles(list);
        // Επιλογή που δεν ισχύει πια → αφαιρείται (όχι όπως το walk-in: ο συνεργάτης δεν παρακάμπτει).
        const current = vehicleRef.current;
        if (current && !list.some((v) => v.id === current)) {
          setVehicleId("");
          setPrice(null);
          setDroppedVehicle(true);
        }
      } catch {
        if (mine === vehSeq.current) setVehicles([]);
      } finally {
        if (mine === vehSeq.current) setLoadingVehicles(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [win, ok, reloadVehicles, done]);

  const allExtras = [...extraIds, ...(insuranceId ? [insuranceId] : [])];
  const base = { vehicleId, ...win, extraIds: allExtras };

  /* ── 4) Τιμή + προμήθεια από τον server (αυτόματα, όπως στο προσωπικό) ── */
  const prevSeq = useRef(0);
  const priceKey = JSON.stringify(base);
  useEffect(() => {
    setPrice(null);
    if (done || !ok || !vehicleId) return;
    const mine = ++prevSeq.current;
    setPricing(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/partner/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...JSON.parse(priceKey), preview: true }),
        });
        const j = await res.json().catch(() => ({}));
        if (mine !== prevSeq.current) return;
        if (res.ok) {
          setPrice({ totalCents: j.data.totalCents, commissionCents: j.data.commissionCents });
          setError("");
        } else {
          setError(j.message || tr("partner.error"));
          if (j.code === "vehicle_unavailable") setReloadVehicles((n) => n + 1);
        }
      } catch {
        if (mine === prevSeq.current) setError(tr("partner.error"));
      } finally {
        if (mine === prevSeq.current) setPricing(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [priceKey, ok, vehicleId, done, tr]);

  const submit = async () => {
    if (busy || !price) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/partner/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...base,
          notes: customer.notes.trim() || null,
          customer: {
            firstName: customer.firstName.trim(),
            lastName: customer.lastName.trim(),
            phone: customer.phone.trim() || null,
            email: customer.email.trim() || null,
          },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.message || tr("partner.error"));
        // Το όχημα το πήρε κάποιος στο μεταξύ: ανανέωση της λίστας (αφαιρεί την επιλογή).
        if (j.code === "vehicle_unavailable") setReloadVehicles((n) => n + 1);
        return;
      }
      setDone(j.data.booking.bookingNumber);
      setPrice({ totalCents: j.data.booking.totalCents, commissionCents: j.data.booking.commissionCents });
      onDone();
    } catch {
      setError(tr("partner.error"));
    } finally {
      setBusy(false);
    }
  };

  const setW = (patch: Partial<Win>) => setWin((w) => ({ ...w, ...patch }));
  const toggleExtra = (id: string) => setExtraIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const canSubmit = !!price && !!vehicleId && !!customer.firstName.trim() && !!customer.lastName.trim() && !busy && !pricing;

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
            <>
            <div className="dash-form-grid">
              {/* 1) Παραλαβή και επιστροφή — ημερομηνία και ώρα μαζί, όπως στο προσωπικό. */}
              <div className="dash-field--wide dash-when">
                <label className="dash-field">
                  {tr("partner.pickupDate")} *
                  <input type="date" value={win.pickupDate} onChange={(e) => setW({ pickupDate: e.target.value })} data-testid="pb-pickup-date" />
                </label>
                <label className="dash-field">
                  {tr("partner.pickupTime")} *
                  <input type="time" value={win.pickupTime} onChange={(e) => setW({ pickupTime: e.target.value })} data-testid="pb-pickup-time" />
                </label>
                <label className="dash-field">
                  {tr("partner.returnDate")} *
                  <input type="date" value={win.returnDate} min={win.pickupDate} onChange={(e) => setW({ returnDate: e.target.value })} data-testid="pb-return-date" />
                </label>
                <label className="dash-field">
                  {tr("partner.returnTime")} *
                  <input type="time" value={win.returnTime} onChange={(e) => setW({ returnTime: e.target.value })} data-testid="pb-return-time" />
                </label>
              </div>
              {!ok && <p className="dash-form-note dash-field--wide">{tr("partner.windowInvalid")}</p>}

              {/* 2) Μόνο τα διαθέσιμα οχήματα για αυτό το διάστημα. */}
              <label className="dash-field dash-field--wide">
                {tr("partner.vehicle")} *
                <select
                  value={vehicleId}
                  onChange={(e) => {
                    setVehicleId(e.target.value);
                    setDroppedVehicle(false);
                  }}
                  disabled={!ok || !vehicles}
                  data-testid="pb-vehicle"
                >
                  <option value="">
                    {!ok ? tr("partner.chooseDatesFirst") : loadingVehicles && !vehicles ? tr("partner.loading") : tr("partner.chooseVehicle")}
                  </option>
                  {(vehicles ?? []).map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
                {ok && vehicles && (
                  <small className="dash-form-note" data-testid="pb-vehicle-count">
                    {vehicles.length === 0 ? tr("partner.noAvailable") : tr("partner.availableCount").replace("{n}", String(vehicles.length))}
                  </small>
                )}
                {droppedVehicle && (
                  <small className="dash-form-error" role="status" data-testid="pb-vehicle-dropped">{tr("partner.vehicleDropped")}</small>
                )}
              </label>

            </div>
            {/* 3) Πρόσθετα και ασφάλεια — ίδια εμφάνιση με τη φόρμα του προσωπικού· τιμή από τον server. */}
              {offeredExtras.length > 0 && (
                <div className="dash-price-section">
                  <h3 className="dash-price-heading">
                    <PackagePlus size={15} /> {tr("partner.extras")}
                  </h3>
                  <div className="dash-pick-grid">
                    {offeredExtras.map((e) => (
                      <label key={e.id} className={`dash-pick ${extraIds.includes(e.id) ? "active" : ""}`}>
                        <input type="checkbox" checked={extraIds.includes(e.id)} onChange={() => toggleExtra(e.id)} />
                        <span className="dash-pick-name">{e.name}</span>
                        <span className="dash-pick-price">
                          {formatEuros(e.price, locale)}
                          <small>{e.chargeType === "PER_DAY" ? tr("extras.perDay") : tr("extras.oneOff")}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {offeredInsurance.length > 0 && (
                <div className="dash-price-section" data-testid="pb-insurance">
                  <h3 className="dash-price-heading">
                    <ShieldCheck size={15} /> {tr("partner.insurance")}
                  </h3>
                  <div className="dash-pick-grid">
                    <label className={`dash-pick ${!insuranceId ? "active" : ""}`}>
                      <input type="radio" name="pb-insurance" checked={!insuranceId} onChange={() => setInsuranceId("")} />
                      <span className="dash-pick-name">{tr("partner.noInsurance")}</span>
                      <span className="dash-pick-price">—</span>
                    </label>
                    {offeredInsurance.map((e) => (
                      <label key={e.id} className={`dash-pick ${insuranceId === e.id ? "active" : ""}`}>
                        <input type="radio" name="pb-insurance" checked={insuranceId === e.id} onChange={() => setInsuranceId(e.id)} />
                        <span className="dash-pick-name">{e.name}</span>
                        <span className="dash-pick-price">
                          {formatEuros(e.price, locale)}
                          <small>{e.chargeType === "PER_DAY" ? tr("extras.perDay") : tr("extras.oneOff")}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

            <div className="dash-form-grid">
              {/* Πελάτης — χωρίς λίστα πελατών της εταιρίας. */}
              <label className="dash-field">
                {tr("partner.firstName")} *
                <input value={customer.firstName} onChange={(e) => setCustomer((c) => ({ ...c, firstName: e.target.value }))} autoComplete="off" data-testid="pb-first" />
              </label>
              <label className="dash-field">
                {tr("partner.lastName")} *
                <input value={customer.lastName} onChange={(e) => setCustomer((c) => ({ ...c, lastName: e.target.value }))} autoComplete="off" data-testid="pb-last" />
              </label>
              <label className="dash-field">
                {tr("partner.phone")}
                <input type="tel" value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} autoComplete="off" data-testid="pb-phone" />
              </label>
              <label className="dash-field">
                {tr("partner.email")}
                <input type="email" value={customer.email} onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))} autoComplete="off" data-testid="pb-email" />
              </label>
              <label className="dash-field dash-field--wide">
                {tr("partner.notes")}
                <textarea rows={2} value={customer.notes} onChange={(e) => setCustomer((c) => ({ ...c, notes: e.target.value }))} />
              </label>
            </div>
            </>
          )}
          {/* 4) Τιμή και προμήθεια — πάντα από τον server. */}
          {(price || pricing) && (
            <dl className="dash-pb-price" data-testid="partner-booking-price" aria-live="polite">
              <dt>{tr("partner.price")}</dt>
              <dd data-testid="pb-total">{price ? formatMoney(price.totalCents, locale) : "…"}</dd>
              <dt>{tr("partner.yourCommission")}</dt>
              <dd data-testid="pb-commission">{price ? formatMoney(price.commissionCents, locale) : "…"}</dd>
            </dl>
          )}
          {!done && <p className="dash-form-note">{tr("partner.priceNote")}</p>}
          {error && <div className="dash-form-error" role="alert" data-testid="pb-error">{error}</div>}
        </div>
        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose}>{tr("partner.cancel")}</button>
          {!done && (
            <button className="dash-btn dash-btn--primary" onClick={submit} disabled={!canSubmit} data-testid="pb-submit">
              {busy ? tr("partner.submitting") : tr("partner.submit")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
