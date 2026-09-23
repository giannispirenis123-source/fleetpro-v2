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
  AlertTriangle,
  Timer,
  Tag,
  ShieldCheck,
  PackagePlus,
  Receipt,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_CLASS,
  STATUS_TRANSITIONS,
  countDays,
  readyAt,
  type BookingConflict,
  type BookingDTO,
} from "@/lib/bookings";
import { formatPrepTime } from "@/lib/prepTime";
import type { ExtraDTO } from "@/lib/extras";
import {
  computePrice,
  round2,
  toDisplayBreakdown,
  type DiscountMode,
  type PriceBreakdown,
} from "@/lib/pricing";

const INTL_LOCALE: Record<string, string> = { el: "el-GR", en: "en-GB" };

// Λεπτά μόνο όταν υπάρχουν: «420 €» αλλά «12,50 €». Σε ανάλυση τιμής η
// στρογγυλοποίηση στο ευρώ θα έκανε τις γραμμές να μην αθροίζουν στο σύνολο.
const eur = (n: number, locale: string) =>
  new Intl.NumberFormat(INTL_LOCALE[locale] ?? "el-GR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(round2(n));

const shortDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? "el-GR", {
    day: "2-digit",
    month: "short",
  }).format(new Date(`${iso}T00:00:00.000Z`));

/** "12 Οκτ 10:30" — η ώρα μπαίνει μόνο αν υπάρχει. */
const dateWithTime = (iso: string, time: string | null, locale: string) =>
  time ? `${shortDate(iso, locale)} ${time}` : shortDate(iso, locale);

/** Οι ISO στιγμές του server σε "12 Οκτ 10:30" της τοπικής μορφής. */
const stampFromIso = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? "el-GR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    // 24ωρη μορφή: οι ώρες αποθηκεύονται ως "HH:mm" και οι κρατήσεις
    // διαβάζονται ευκολότερα χωρίς π.μ./μ.μ.
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(iso));

interface Option {
  id: string;
  label: string;
}

interface VehicleOption extends Option {
  dailyRate: number;
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

/** Τυπική ώρα γραφείου, ώστε να μη χρειάζεται πληκτρολόγηση στη συνηθισμένη περίπτωση. */
const DEFAULT_TIME = "10:00";

const emptyForm = (): FormState => ({
  customerId: "",
  vehicleId: "",
  pickupDate: today(),
  pickupTime: DEFAULT_TIME,
  returnDate: today(),
  returnTime: DEFAULT_TIME,
  status: "PENDING",
  notes: "",
  extraIds: [],
  insuranceId: "",
  discountMode: "NONE",
  discountValue: "",
  discountCode: "",
});

interface FormState {
  customerId: string;
  vehicleId: string;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  status: string;
  notes: string;

  /* ── Τιμολόγηση ── */
  extraIds: string[];
  insuranceId: string;
  discountMode: DiscountMode;
  discountValue: string;
  discountCode: string;
}

// Οι παλιές κρατήσεις δεν έχουν ώρες· τα πεδία ανοίγουν κενά και η φόρμα
// τις απαιτεί πριν την αποθήκευση.
const formFromBooking = (b: BookingDTO): FormState => ({
  customerId: b.customerId,
  vehicleId: b.vehicleId,
  pickupDate: b.pickupDate,
  pickupTime: b.pickupTime ?? "",
  returnDate: b.returnDate,
  returnTime: b.returnTime ?? "",
  status: b.status,
  notes: b.notes ?? "",
  // Τα πρόσθετα έρχονται από το snapshot της κράτησης.
  extraIds: b.extras.filter((e) => e.type === "EXTRA").map((e) => e.id),
  insuranceId: b.extras.find((e) => e.type === "INSURANCE")?.id ?? "",
  discountMode: b.discountCode
    ? "CODE"
    : b.discountAmount > 0
      ? "AMOUNT"
      : "NONE",
  discountValue: b.discountAmount > 0 ? String(b.discountAmount) : "",
  discountCode: b.discountCode ?? "",
});

export default function BookingsClient({
  initialBookings,
  customers,
  vehicles,
  extras,
  tenantId,
  rentalMode,
  prepMinutes,
  roundUpTotal,
  role,
}: {
  initialBookings: BookingDTO[];
  customers: Option[];
  vehicles: VehicleOption[];
  extras: ExtraDTO[];
  tenantId: string;
  rentalMode: string;
  prepMinutes: number;
  roundUpTotal: boolean;
  role: string;
}) {
  const tr = useT();
  const locale = useLocale();

  const canManage = role === "COMPANY_ADMIN" || role === "STAFF";
  // Μόνο ο διαχειριστής μπορεί να εγκρίνει κράτηση που συγκρούεται.
  const isAdmin = role === "COMPANY_ADMIN";
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

  // Χειροκίνητη έκδοση τιμολογίου από την κάρτα της κράτησης.
  const [issuingId, setIssuingId] = useState<string | null>(null);
  const [issueError, setIssueError] = useState("");

  const issueInvoice = async (b: BookingDTO) => {
    if (issuingId) return;

    setIssuingId(b.id);
    setIssueError("");

    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: b.id }),
      });
      const data = await res.json();

      if (!res.ok) {
        setIssueError(data.message || tr("bookings.invoiceError"));
        return;
      }

      // Είτε μόλις εκδόθηκε είτε υπήρχε ήδη, η κάρτα δείχνει από εδώ και
      // πέρα τον αριθμό — άρα το κουμπί δεν ξαναεμφανίζεται.
      const invoiceNumber: string = data.data.invoice.invoiceNumber;
      setBookings((prev) =>
        prev.map((x) => (x.id === b.id ? { ...x, invoiceNumber } : x))
      );
    } catch {
      setIssueError(tr("bookings.invoiceError"));
    } finally {
      setIssuingId(null);
    }
  };

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

      {issueError && <div className="dash-form-error">{issueError}</div>}

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
              prepMinutes={prepMinutes}
              canManage={canManage}
              onEdit={() => setEditing(b)}
              onCancel={() => setCancelling(b)}
              issuing={issuingId === b.id}
              onIssueInvoice={() => issueInvoice(b)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <BookingModal
          mode="create"
          tr={tr}
          locale={locale}
          customers={customers}
          vehicles={vehicles}
          extras={extras}
          tenantId={tenantId}
          isRequestMode={isRequestMode}
          isAdmin={isAdmin}
          prepMinutes={prepMinutes}
          roundUpTotal={roundUpTotal}
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
          locale={locale}
          customers={customers}
          vehicles={vehicles}
          extras={extras}
          tenantId={tenantId}
          isRequestMode={isRequestMode}
          isAdmin={isAdmin}
          prepMinutes={prepMinutes}
          roundUpTotal={roundUpTotal}
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

/** Μία γραμμή της ανάλυσης τιμής. */
function PriceRow({
  label,
  value,
  strong,
  sub,
  negative,
}: {
  label: string;
  value: string;
  strong?: boolean;
  sub?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={`dash-price-row${strong ? " total" : ""}${sub ? " sub" : ""}${
        negative ? " minus" : ""
      }`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
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
  prepMinutes,
  canManage,
  onEdit,
  onCancel,
  issuing,
  onIssueInvoice,
}: {
  booking: BookingDTO;
  locale: string;
  tr: (key: string) => string;
  recordWord: string;
  prepMinutes: number;
  canManage: boolean;
  onEdit: () => void;
  onCancel: () => void;
  issuing: boolean;
  onIssueInvoice: () => void;
}) {
  const closed = b.status === "CANCELLED" || b.status === "COMPLETED";

  // Η στρογγυλοποίηση απορροφάται στις υπάρχουσες γραμμές — ίδιος κανόνας
  // με τη φόρμα, ώστε η κάρτα να δείχνει ακριβώς το ίδιο σπάσιμο.
  const view = toDisplayBreakdown(b);

  // Πότε το όχημα είναι ξανά ελεύθερο. Το δείχνουμε μόνο όταν η κράτηση
  // κρατά ακόμη το όχημα και η εταιρία έχει ορίσει χρόνο προετοιμασίας.
  const showReady = !closed && prepMinutes > 0;
  const readyStamp = showReady
    ? stampFromIso(
        new Date(readyAt(b.returnDate, b.returnTime, prepMinutes)).toISOString(),
        locale
      )
    : null;

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
          <CalendarDays size={13} />{" "}
          {dateWithTime(b.pickupDate, b.pickupTime, locale)}{" "}
          <ArrowRight size={11} />{" "}
          {dateWithTime(b.returnDate, b.returnTime, locale)} ({b.totalDays}{" "}
          {b.totalDays === 1 ? tr("bookings.dayOne") : tr("bookings.days")})
        </span>
        {readyStamp && (
          <span className="dash-booking-ready">
            <Timer size={13} /> {tr("bookings.conflictReadyAt")} {readyStamp} ·{" "}
            {formatPrepTime(prepMinutes, locale)}
          </span>
        )}
      </div>

      {/* Ανάλυση τιμής — μόνο ό,τι έχει αξία, για να μη φουσκώνει η κάρτα. */}
      <div className="dash-breakdown dash-breakdown--card">
        <PriceRow
          label={
            // Το «ημέρες × τιμή» φεύγει όταν το subtotal έχει απορροφήσει
            // στρογγυλοποίηση — αλλιώς ο πολλαπλασιασμός δεν θα έβγαινε.
            view.subtotalAdjusted
              ? tr("bookings.priceSubtotal")
              : `${tr("bookings.priceSubtotal")} · ${b.totalDays} × ${eur(
                  b.dailyRate,
                  locale
                )}`
          }
          value={eur(view.subtotal, locale)}
        />
        {view.extrasTotal > 0 && (
          <PriceRow
            label={tr("bookings.priceExtras")}
            value={eur(view.extrasTotal, locale)}
          />
        )}
        {view.insuranceCost > 0 && (
          <PriceRow
            label={tr("bookings.priceInsurance")}
            value={eur(view.insuranceCost, locale)}
          />
        )}
        {view.discountAmount > 0 && (
          <PriceRow
            negative
            label={
              b.discountCode
                ? `${tr("bookings.priceDiscount")} · ${b.discountCode}`
                : tr("bookings.priceDiscount")
            }
            value={`−${eur(view.discountAmount, locale)}`}
          />
        )}
      </div>

      <div className="dash-vehicle-foot">
        <span className="dash-vehicle-rate">{eur(b.total, locale)}</span>
        {canManage && (
          <div className="dash-vehicle-actions">
            {/* Μία κράτηση, ένα τιμολόγιο: με τον αριθμό εκδομένο δεν
                υπάρχει πια κουμπί έκδοσης, μόνο η ένδειξη. */}
            {b.invoiceNumber ? (
              <span className="dash-badge dash-badge--ok" title={tr("bookings.invoiceLabel")}>
                <Receipt size={13} /> {b.invoiceNumber}
              </span>
            ) : (
              b.status !== "CANCELLED" && (
                <button
                  className="dash-icon-btn"
                  onClick={onIssueInvoice}
                  disabled={issuing}
                  title={tr("bookings.issueInvoice")}
                  aria-label={tr("bookings.issueInvoice")}
                >
                  <Receipt size={16} />
                </button>
              )
            )}
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
  locale,
  customers,
  vehicles,
  extras,
  tenantId,
  isRequestMode,
  isAdmin,
  prepMinutes,
  roundUpTotal,
  recordWord,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  booking?: BookingDTO;
  tr: (key: string) => string;
  locale: string;
  customers: Option[];
  vehicles: VehicleOption[];
  extras: ExtraDTO[];
  tenantId: string;
  isRequestMode: boolean;
  isAdmin: boolean;
  prepMinutes: number;
  /** Ρύθμιση εταιρίας — η προεπισκόπηση πρέπει να δείχνει ό,τι θα αποθηκευτεί. */
  roundUpTotal: boolean;
  recordWord: string;
  onClose: () => void;
  onSaved: (booking: BookingDTO) => void;
}) {
  const [form, setForm] = useState<FormState>(
    booking ? formFromBooking(booking) : emptyForm()
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<BookingConflict[] | null>(null);

  /** Πεδία που μετακινούν τη βάση της έκπτωσης. */
  const PRICE_KEYS: (keyof FormState)[] = [
    "vehicleId",
    "pickupDate",
    "returnDate",
    "extraIds",
    "insuranceId",
  ];

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    // Κάθε αλλαγή στοιχείου ακυρώνει την προηγούμενη προειδοποίηση: οι
    // συγκρούσεις αφορούσαν τις παλιές τιμές.
    setConflicts(null);
    // Ο κωδικός υπολογίστηκε πάνω στην παλιά βάση — πρέπει να ξαναμπεί.
    if (PRICE_KEYS.includes(key)) resetCode();
    setForm((f) => ({ ...f, [key]: value }));
  };

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

  /* ── Τιμολόγηση ── */

  const offeredExtras = extras.filter((e) => e.type === "EXTRA");
  const offeredInsurance = extras.filter((e) => e.type === "INSURANCE");

  // Το ποσό του κωδικού το δίνει ο server· εδώ το κρατάμε μόνο για την
  // προεπισκόπηση. Ο server το ξαναϋπολογίζει στην αποθήκευση.
  const [codeAmount, setCodeAmount] = useState(0);
  const [codeMessage, setCodeMessage] = useState("");
  const [codeError, setCodeError] = useState("");
  const [checkingCode, setCheckingCode] = useState(false);

  const selectedVehicle = vehicles.find((v) => v.id === form.vehicleId);

  const chosenExtras = [
    ...offeredExtras.filter((e) => form.extraIds.includes(e.id)),
    ...offeredInsurance.filter((e) => e.id === form.insuranceId),
  ];

  const preview: PriceBreakdown = computePrice({
    totalDays: days ?? 1,
    dailyRate: selectedVehicle?.dailyRate ?? 0,
    extras: chosenExtras,
    discountMode: form.discountMode,
    discountValue: Number(form.discountValue) || 0,
    codeDiscountAmount: codeAmount,
    roundUpTotal,
  });

  // Η στρογγυλοποίηση δεν εμφανίζεται ως ξεχωριστή γραμμή: απορροφάται
  // πρώτα από την έκπτωση και, ό,τι περισσεύει, από το ενοίκιο.
  const view = toDisplayBreakdown(preview);

  const toggleExtra = (id: string) => {
    resetCode();
    setConflicts(null);
    setForm((f) => ({
      ...f,
      extraIds: f.extraIds.includes(id)
        ? f.extraIds.filter((x) => x !== id)
        : [...f.extraIds, id],
    }));
  };

  // Κάθε αλλαγή που μετακινεί τη βάση ακυρώνει τον ήδη εφαρμοσμένο κωδικό:
  // το ποσό του εξαρτάται από αυτήν.
  const resetCode = () => {
    setCodeAmount(0);
    setCodeMessage("");
    setCodeError("");
  };

  const applyCode = async () => {
    const code = form.discountCode.trim();
    if (!code || checkingCode) return;

    setCheckingCode(true);
    setCodeError("");
    setCodeMessage("");

    try {
      const withoutDiscount = computePrice({
        totalDays: days ?? 1,
        dailyRate: selectedVehicle?.dailyRate ?? 0,
        extras: chosenExtras,
        discountMode: "NONE",
      });

      const res = await fetch("/api/discounts/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          tenantId,
          totalAmount: withoutDiscount.beforeDiscount,
          totalDays: days ?? 1,
          vehicleId: form.vehicleId || undefined,
          customerId: form.customerId || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setCodeAmount(0);
        setCodeError(data.message || tr("bookings.discountInvalid"));
        return;
      }

      setCodeAmount(data.data.discountAmount);
      setCodeMessage(data.data.message);
    } catch {
      setCodeError(tr("bookings.errorConnection"));
    } finally {
      setCheckingCode(false);
    }
  };

  /**
   * override = true σημαίνει «ο διαχειριστής είδε τη σύγκρουση και την
   * εγκρίνει». Ο server το ξαναελέγχει και το δέχεται μόνο από COMPANY_ADMIN.
   */
  const handleSubmit = async (override = false) => {
    if (!form.customerId || !form.vehicleId) {
      setError(tr("bookings.errorMissing"));
      return;
    }
    if (!form.pickupTime || !form.returnTime) {
      setError(tr("bookings.errorMissingTime"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const payload: Record<string, unknown> = {
        customerId: form.customerId,
        vehicleId: form.vehicleId,
        pickupDate: form.pickupDate,
        pickupTime: form.pickupTime,
        returnDate: form.returnDate,
        returnTime: form.returnTime,
        notes: form.notes.trim() || null,
      };
      if (!lockStatus) payload.status = form.status;
      if (override) payload.override = true;

      // Στέλνουμε ΜΟΝΟ επιλογές. Κανένα ποσό — ο server τα ξαναβγάζει.
      payload.extraIds = [
        ...form.extraIds,
        ...(form.insuranceId ? [form.insuranceId] : []),
      ];
      payload.discountMode = form.discountMode;
      if (form.discountMode === "AMOUNT" || form.discountMode === "PERCENT") {
        payload.discountValue = Number(form.discountValue) || 0;
      }
      payload.discountCode =
        form.discountMode === "CODE" ? form.discountCode.trim() : null;

      const res = await fetch(
        mode === "create" ? "/api/bookings" : `/api/bookings/${booking!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();

      if (res.status === 409) {
        setConflicts((data.conflicts as BookingConflict[]) ?? []);
        return;
      }

      if (!res.ok) {
        setConflicts(null);
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

            {/* Ημερομηνία και ώρα μαζί, ώστε να διαβάζονται ως ένα ζεύγος. */}
            <div className="dash-field--wide dash-when">
              <label className="dash-field">
                {tr("bookings.pickupDate")} *
                <input
                  type="date"
                  value={form.pickupDate}
                  onChange={(e) => set("pickupDate", e.target.value)}
                />
              </label>
              <label className="dash-field">
                {tr("bookings.pickupTime")} *
                <input
                  type="time"
                  required
                  value={form.pickupTime}
                  onChange={(e) => set("pickupTime", e.target.value)}
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
                {tr("bookings.returnTime")} *
                <input
                  type="time"
                  required
                  value={form.returnTime}
                  onChange={(e) => set("returnTime", e.target.value)}
                />
              </label>
            </div>

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
              {prepMinutes > 0 && (
                <>
                  {" · "}
                  {tr("settings.prepTime")}:{" "}
                  {formatPrepTime(prepMinutes, locale)}
                </>
              )}
            </p>
          )}

          {/* ── Πρόσθετα ── */}
          {offeredExtras.length > 0 && (
            <div className="dash-price-section">
              <h3 className="dash-price-heading">
                <PackagePlus size={15} /> {tr("bookings.extrasTitle")}
              </h3>
              <div className="dash-pick-grid">
                {offeredExtras.map((e) => (
                  <label
                    key={e.id}
                    className={`dash-pick ${
                      form.extraIds.includes(e.id) ? "active" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={form.extraIds.includes(e.id)}
                      onChange={() => toggleExtra(e.id)}
                    />
                    <span className="dash-pick-name">{e.name}</span>
                    <span className="dash-pick-price">
                      {eur(e.price, locale)}
                      <small>
                        {e.chargeType === "PER_DAY"
                          ? tr("extras.perDay")
                          : tr("extras.oneOff")}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── Ασφάλεια: μία το πολύ ── */}
          {offeredInsurance.length > 0 && (
            <div className="dash-price-section">
              <h3 className="dash-price-heading">
                <ShieldCheck size={15} /> {tr("bookings.insuranceTitle")}
              </h3>
              <div className="dash-pick-grid">
                <label
                  className={`dash-pick ${!form.insuranceId ? "active" : ""}`}
                >
                  <input
                    type="radio"
                    name="insurance"
                    checked={!form.insuranceId}
                    onChange={() => set("insuranceId", "")}
                  />
                  <span className="dash-pick-name">
                    {tr("bookings.insuranceNone")}
                  </span>
                  <span className="dash-pick-price">—</span>
                </label>
                {offeredInsurance.map((e) => (
                  <label
                    key={e.id}
                    className={`dash-pick ${
                      form.insuranceId === e.id ? "active" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="insurance"
                      checked={form.insuranceId === e.id}
                      onChange={() => set("insuranceId", e.id)}
                    />
                    <span className="dash-pick-name">{e.name}</span>
                    <span className="dash-pick-price">
                      {eur(e.price, locale)}
                      <small>
                        {e.chargeType === "PER_DAY"
                          ? tr("extras.perDay")
                          : tr("extras.oneOff")}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── Έκπτωση ── */}
          <div className="dash-price-section">
            <h3 className="dash-price-heading">
              <Tag size={15} /> {tr("bookings.discountTitle")}
            </h3>

            <div className="dash-filters dash-discount-modes">
              {(["NONE", "AMOUNT", "PERCENT", "CODE"] as DiscountMode[]).map(
                (m) => (
                  <button
                    key={m}
                    type="button"
                    className={`dash-filter ${
                      form.discountMode === m ? "active" : ""
                    }`}
                    onClick={() => {
                      resetCode();
                      set("discountMode", m);
                    }}
                    aria-pressed={form.discountMode === m}
                  >
                    {tr(`bookings.discountMode${m}`)}
                  </button>
                )
              )}
            </div>

            {(form.discountMode === "AMOUNT" ||
              form.discountMode === "PERCENT") && (
              <label className="dash-field dash-field--xs">
                {form.discountMode === "AMOUNT"
                  ? tr("bookings.discountAmountLabel")
                  : tr("bookings.discountPercentLabel")}
                <input
                  type="number"
                  min={0}
                  max={form.discountMode === "PERCENT" ? 100 : undefined}
                  step={form.discountMode === "PERCENT" ? 1 : 0.5}
                  inputMode="decimal"
                  value={form.discountValue}
                  onChange={(e) => set("discountValue", e.target.value)}
                />
              </label>
            )}

            {form.discountMode === "CODE" && (
              <>
                <div className="dash-code-row">
                  <label className="dash-field">
                    {tr("bookings.discountCodeLabel")}
                    <input
                      value={form.discountCode}
                      onChange={(e) => {
                        resetCode();
                        set("discountCode", e.target.value.toUpperCase());
                      }}
                      placeholder="SUMMER25"
                    />
                  </label>
                  <button
                    type="button"
                    className="dash-btn"
                    onClick={applyCode}
                    disabled={!form.discountCode.trim() || checkingCode}
                  >
                    {checkingCode
                      ? tr("bookings.discountChecking")
                      : tr("bookings.discountApply")}
                  </button>
                </div>
                {codeMessage && (
                  <div className="dash-alert-ok dash-code-ok">
                    {codeMessage} · −{eur(codeAmount, locale)}
                  </div>
                )}
                {codeError && <div className="dash-form-error">{codeError}</div>}
              </>
            )}
          </div>

          {/* ── Ζωντανή ανάλυση τιμής ── */}
          <div className="dash-breakdown">
            <PriceRow
              label={
                view.subtotalAdjusted
                  ? tr("bookings.priceSubtotal")
                  : `${tr("bookings.priceSubtotal")} · ${preview.totalDays} × ${eur(
                      preview.dailyRate,
                      locale
                    )}`
              }
              value={eur(view.subtotal, locale)}
            />
            {preview.lines
              .filter((l) => l.type === "EXTRA")
              .map((l) => (
                <PriceRow
                  key={l.id}
                  sub
                  label={l.name}
                  value={eur(l.lineTotal, locale)}
                />
              ))}
            {view.extrasTotal > 0 && (
              <PriceRow
                label={tr("bookings.priceExtras")}
                value={eur(view.extrasTotal, locale)}
              />
            )}
            {view.insuranceCost > 0 && (
              <PriceRow
                label={tr("bookings.priceInsurance")}
                value={eur(view.insuranceCost, locale)}
              />
            )}
            {view.discountAmount > 0 && (
              <PriceRow
                negative
                label={tr("bookings.priceDiscount")}
                value={`−${eur(view.discountAmount, locale)}`}
              />
            )}
            <PriceRow
              strong
              label={tr("bookings.priceTotal")}
              value={eur(view.total, locale)}
            />
          </div>

          {conflicts && conflicts.length > 0 && (
            <div className="dash-conflict">
              <p className="dash-conflict-title">
                <AlertTriangle size={16} /> {tr("bookings.conflictTitle")}
              </p>
              <p className="dash-conflict-lead">{tr("bookings.conflictLead")}</p>
              <ul className="dash-conflict-list">
                {conflicts.map((c) => (
                  <li key={c.bookingId}>
                    <strong>{c.bookingNumber}</strong>{" "}
                    <span
                      className={`dash-status dash-status--${
                        c.kind === "OVERLAP" ? "bad" : "warn"
                      }`}
                    >
                      {c.kind === "OVERLAP"
                        ? tr("bookings.conflictOverlap")
                        : tr("bookings.conflictPrep")}
                    </span>
                    <span className="dash-conflict-times">
                      {tr("bookings.conflictReturnAt")}{" "}
                      {stampFromIso(c.returnAt, locale)} ·{" "}
                      {tr("bookings.conflictReadyAt")}{" "}
                      {stampFromIso(c.readyAt, locale)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="dash-conflict-note">
                {isAdmin
                  ? tr("bookings.conflictAdminNote")
                  : tr("bookings.conflictStaffNote")}
              </p>
            </div>
          )}

          {error && <div className="dash-form-error">{error}</div>}
          <p className="dash-form-note">{tr("bookings.priceNote")}</p>
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose} disabled={loading}>
            {tr("bookings.cancel")}
          </button>
          {conflicts && conflicts.length > 0 ? (
            isAdmin ? (
              <button
                className="dash-btn dash-btn--danger"
                onClick={() => handleSubmit(true)}
                disabled={loading}
              >
                {loading
                  ? tr("bookings.saving")
                  : tr("bookings.conflictApprove")}
              </button>
            ) : null
          ) : (
            <button
              className="dash-btn dash-btn--primary"
              onClick={() => handleSubmit()}
              disabled={loading}
            >
              {loading
                ? tr("bookings.saving")
                : isRequestMode
                  ? tr("bookings.saveRequest")
                  : tr("bookings.saveBooking")}
            </button>
          )}
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
