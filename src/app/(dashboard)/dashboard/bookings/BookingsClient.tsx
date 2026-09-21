"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Ban,
  X,
  CalendarDays,
  Car,
  User,
  ArrowRight,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_CLASS,
  STATUS_TRANSITIONS,
  countDays,
  type BookingDTO,
} from "@/lib/bookings";

const INTL_LOCALE: Record<string, string> = { el: "el-GR", en: "en-GB" };

const eur = (n: number, locale: string) =>
  new Intl.NumberFormat(INTL_LOCALE[locale] ?? "el-GR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);

const shortDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? "el-GR", {
    day: "2-digit",
    month: "short",
  }).format(new Date(`${iso}T00:00:00.000Z`));

interface Option {
  id: string;
  label: string;
}

type StatusFilter = "ALL" | (typeof BOOKING_STATUSES)[number];

const FILTERS: StatusFilter[] = [
  "ALL",
  "PENDING",
  "CONFIRMED",
  "ACTIVE",
  "COMPLETED",
];

const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): FormState => ({
  customerId: "",
  vehicleId: "",
  pickupDate: today(),
  returnDate: today(),
  status: "PENDING",
  notes: "",
});

interface FormState {
  customerId: string;
  vehicleId: string;
  pickupDate: string;
  returnDate: string;
  status: string;
  notes: string;
}

const formFromBooking = (b: BookingDTO): FormState => ({
  customerId: b.customerId,
  vehicleId: b.vehicleId,
  pickupDate: b.pickupDate,
  returnDate: b.returnDate,
  status: b.status,
  notes: b.notes ?? "",
});

export default function BookingsClient({
  initialBookings,
  customers,
  vehicles,
  rentalMode,
  role,
}: {
  initialBookings: BookingDTO[];
  customers: Option[];
  vehicles: Option[];
  rentalMode: string;
  role: string;
}) {
  const tr = useT();
  const locale = useLocale();

  const canManage = role === "COMPANY_ADMIN" || role === "STAFF";
  const isRequestMode = rentalMode === "REQUEST";

  // Η ίδια ορολογία παντού: «Κράτηση» ή «Αίτημα». Οι φράσεις είναι πλήρεις
  // ανά περίπτωση, ώστε να συμφωνεί το γένος στα Ελληνικά.
  const recordWord = isRequestMode
    ? tr("bookings.recordRequest")
    : tr("bookings.recordBooking");
  const addLabel = isRequestMode
    ? tr("bookings.addRequest")
    : tr("bookings.addBooking");

  const [bookings, setBookings] = useState<BookingDTO[]>(initialBookings);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<BookingDTO | null>(null);
  const [cancelling, setCancelling] = useState<BookingDTO | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((b) => {
      const matchesStatus = filter === "ALL" || b.status === filter;
      const matchesSearch =
        !q ||
        [b.bookingNumber, b.customerName, b.vehicleName, b.vehiclePlate]
          .join(" ")
          .toLowerCase()
          .includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [bookings, search, filter]);

  const upsert = (booking: BookingDTO) =>
    setBookings((prev) => {
      const exists = prev.some((b) => b.id === booking.id);
      return exists
        ? prev.map((b) => (b.id === booking.id ? booking : b))
        : [booking, ...prev];
    });

  return (
    <>
      <div className="dash-page-head dash-head-row">
        <div>
          <h1 className="dash-page-title">{tr("bookings.title")}</h1>
          <p className="dash-page-sub">
            {isRequestMode
              ? tr("bookings.subtitleRequest")
              : tr("bookings.subtitleBooking")}
          </p>
        </div>
        {canManage && (
          <button
            className="dash-btn dash-btn--primary"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={17} /> {addLabel}
          </button>
        )}
      </div>

      <div className="dash-toolbar">
        <div className="dash-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("bookings.searchPlaceholder")}
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
              {f === "ALL" ? tr("bookings.filterAll") : tr(`status.${f}`)}
            </button>
          ))}
        </div>
        <span className="dash-count">
          {visible.length}{" "}
          {visible.length === 1
            ? tr("bookings.bookingCountOne")
            : tr("bookings.bookingCount")}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="dash-panel dash-empty">
          {bookings.length === 0
            ? tr("bookings.empty")
            : tr("bookings.emptyFiltered")}
        </div>
      ) : (
        <div className="dash-vehicles">
          {visible.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              locale={locale}
              tr={tr}
              recordWord={recordWord}
              canManage={canManage}
              onEdit={() => setEditing(b)}
              onCancel={() => setCancelling(b)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <BookingModal
          mode="create"
          tr={tr}
          customers={customers}
          vehicles={vehicles}
          isRequestMode={isRequestMode}
          recordWord={recordWord}
          onClose={() => setShowCreate(false)}
          onSaved={(booking) => {
            upsert(booking);
            setShowCreate(false);
          }}
        />
      )}

      {editing && (
        <BookingModal
          mode="edit"
          booking={editing}
          tr={tr}
          customers={customers}
          vehicles={vehicles}
          isRequestMode={isRequestMode}
          recordWord={recordWord}
          onClose={() => setEditing(null)}
          onSaved={(booking) => {
            upsert(booking);
            setEditing(null);
          }}
        />
      )}

      {cancelling && (
        <CancelBookingModal
          booking={cancelling}
          tr={tr}
          onClose={() => setCancelling(null)}
          onCancelled={(booking) => {
            upsert(booking);
            setCancelling(null);
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Κάρτα κράτησης / αιτήματος
   ───────────────────────────────────────────── */

function BookingCard({
  booking: b,
  locale,
  tr,
  recordWord,
  canManage,
  onEdit,
  onCancel,
}: {
  booking: BookingDTO;
  locale: string;
  tr: (key: string) => string;
  recordWord: string;
  canManage: boolean;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const closed = b.status === "CANCELLED" || b.status === "COMPLETED";

  return (
    <div className="dash-vehicle">
      <div className="dash-vehicle-top">
        <div className="dash-vehicle-icon">
          <CalendarDays size={20} />
        </div>
        <div className="dash-vehicle-id">
          <span className="dash-vehicle-name">{b.bookingNumber}</span>
          <span className="dash-vehicle-plate dash-customer-city">
            {recordWord}
          </span>
        </div>
        <span
          className={`dash-status dash-status--${
            BOOKING_STATUS_CLASS[b.status] ?? "muted"
          }`}
        >
          {tr(`status.${b.status}`)}
        </span>
      </div>

      <div className="dash-vehicle-specs">
        <span>
          <User size={13} /> {b.customerName}
        </span>
        <span>
          <Car size={13} /> {b.vehicleName} · {b.vehiclePlate}
        </span>
        <span>
          <CalendarDays size={13} /> {shortDate(b.pickupDate, locale)}{" "}
          <ArrowRight size={11} /> {shortDate(b.returnDate, locale)} ({b.totalDays}{" "}
          {b.totalDays === 1 ? tr("bookings.dayOne") : tr("bookings.days")})
        </span>
      </div>

      <div className="dash-vehicle-foot">
        <span className="dash-vehicle-rate">{eur(b.total, locale)}</span>
        {canManage && (
          <div className="dash-vehicle-actions">
            <button
              className="dash-icon-btn"
              onClick={onEdit}
              title={tr("bookings.edit")}
              aria-label={tr("bookings.edit")}
            >
              <Pencil size={16} />
            </button>
            {!closed && (
              <button
                className="dash-icon-btn dash-icon-btn--danger"
                onClick={onCancel}
                title={tr("bookings.cancelBooking")}
                aria-label={tr("bookings.cancelBooking")}
              >
                <Ban size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Modal δημιουργίας / επεξεργασίας
   ───────────────────────────────────────────── */

function BookingModal({
  mode,
  booking,
  tr,
  customers,
  vehicles,
  isRequestMode,
  recordWord,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  booking?: BookingDTO;
  tr: (key: string) => string;
  customers: Option[];
  vehicles: Option[];
  isRequestMode: boolean;
  recordWord: string;
  onClose: () => void;
  onSaved: (booking: BookingDTO) => void;
}) {
  const [form, setForm] = useState<FormState>(
    booking ? formFromBooking(booking) : emptyForm()
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Στη δημιουργία με λειτουργία αιτημάτων η κατάσταση είναι κλειδωμένη σε
  // PENDING — ο server το επιβάλλει ούτως ή άλλως.
  const lockStatus = mode === "create" && isRequestMode;

  // Στην επεξεργασία προσφέρουμε μόνο τις επιτρεπτές μεταβάσεις.
  const statusOptions =
    mode === "edit" && booking
      ? [booking.status, ...(STATUS_TRANSITIONS[booking.status] ?? [])]
      : [...BOOKING_STATUSES];

  const days =
    form.pickupDate && form.returnDate && form.returnDate >= form.pickupDate
      ? countDays(form.pickupDate, form.returnDate)
      : null;

  const handleSubmit = async () => {
    if (!form.customerId || !form.vehicleId) {
      setError(tr("bookings.errorMissing"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const payload: Record<string, unknown> = {
        customerId: form.customerId,
        vehicleId: form.vehicleId,
        pickupDate: form.pickupDate,
        returnDate: form.returnDate,
        notes: form.notes.trim() || null,
      };
      if (!lockStatus) payload.status = form.status;

      const res = await fetch(
        mode === "create" ? "/api/bookings" : `/api/bookings/${booking!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || tr("bookings.errorSave"));
        return;
      }

      onSaved(data.data.booking);
    } catch {
      setError(tr("bookings.errorConnection"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>
            {mode === "create"
              ? isRequestMode
                ? tr("bookings.addRequest")
                : tr("bookings.addBooking")
              : isRequestMode
                ? tr("bookings.editRequest")
                : tr("bookings.editBooking")}
          </h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dash-modal-body">
          {lockStatus && (
            <div className="dash-alert dash-alert--info dash-mode-hint">
              {tr("bookings.requestModeHint")}
            </div>
          )}

          <div className="dash-form-grid">
            <label className="dash-field dash-field--wide">
              {tr("bookings.customer")} *
              <select
                value={form.customerId}
                onChange={(e) => set("customerId", e.target.value)}
              >
                <option value="">{tr("bookings.selectCustomer")}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="dash-field dash-field--wide">
              {tr("bookings.vehicle")} *
              <select
                value={form.vehicleId}
                onChange={(e) => set("vehicleId", e.target.value)}
              >
                <option value="">{tr("bookings.selectVehicle")}</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="dash-field">
              {tr("bookings.pickupDate")} *
              <input
                type="date"
                value={form.pickupDate}
                onChange={(e) => set("pickupDate", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("bookings.returnDate")} *
              <input
                type="date"
                value={form.returnDate}
                onChange={(e) => set("returnDate", e.target.value)}
              />
            </label>

            <label className="dash-field">
              {tr("bookings.status")}
              <select
                value={lockStatus ? "PENDING" : form.status}
                onChange={(e) => set("status", e.target.value)}
                disabled={lockStatus}
              >
                {(lockStatus ? ["PENDING"] : statusOptions).map((s) => (
                  <option key={s} value={s}>
                    {tr(`status.${s}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="dash-field dash-field--wide">
              {tr("bookings.notes")}
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </label>
          </div>

          {days !== null && (
            <p className="dash-form-note">
              {days} {days === 1 ? tr("bookings.dayOne") : tr("bookings.days")}
            </p>
          )}
          {error && <div className="dash-form-error">{error}</div>}
          <p className="dash-form-note">{tr("bookings.priceNote")}</p>
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose} disabled={loading}>
            {tr("bookings.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading
              ? tr("bookings.saving")
              : isRequestMode
                ? tr("bookings.saveRequest")
                : tr("bookings.saveBooking")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Επιβεβαίωση ακύρωσης
   ───────────────────────────────────────────── */

function CancelBookingModal({
  booking,
  tr,
  onClose,
  onCancelled,
}: {
  booking: BookingDTO;
  tr: (key: string) => string;
  onClose: () => void;
  onCancelled: (booking: BookingDTO) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCancel = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.message || tr("bookings.errorSave"));
        return;
      }

      onCancelled(data.data.booking);
    } catch {
      setError(tr("bookings.errorConnection"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div
        className="dash-modal dash-modal--sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dash-modal-header">
          <h2>{tr("bookings.confirmCancelTitle")}</h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dash-modal-body">
          <p className="dash-confirm-vehicle">
            {booking.bookingNumber} · {booking.customerName}
          </p>
          <p className="dash-form-note">{tr("bookings.confirmCancelBody")}</p>
          {error && <div className="dash-form-error">{error}</div>}
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose} disabled={loading}>
            {tr("bookings.back")}
          </button>
          <button
            className="dash-btn dash-btn--danger"
            onClick={handleCancel}
            disabled={loading}
          >
            {loading ? tr("bookings.cancelling") : tr("bookings.confirmCancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
