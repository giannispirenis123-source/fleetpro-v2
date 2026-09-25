"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Rows3,
  Car,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_CLASS,
  type BookingDTO,
} from "@/lib/bookings";
import {
  monthDays,
  monthGrid,
  monthLabel,
  placeInRange,
  shiftMonth,
  coversDay,
  currentMonth,
  todayKey,
  type MonthKey,
} from "@/lib/calendar";

type View = "month" | "timeline";

export interface VehicleRow {
  id: string;
  name: string;
  plate: string;
}

/** Πόσα chip χωράει ένα κελί πριν μαζευτούν σε «+N ακόμα». */
const CHIPS_PER_DAY = 3;
/**
 * Πλάτος στήλης ημέρας στο timeline, σε px. Επιλεγμένο ώστε ένας ολόκληρος
 * μήνας (31 ημέρες + η στήλη οχήματος) να χωράει σε οθόνη υπολογιστή
 * χωρίς κύλιση· σε στενή οθόνη το πάνελ κυλάει οριζόντια.
 */
const DAY_WIDTH = 28;
/** Πλάτος της στήλης με το όνομα οχήματος — ίδιο με το CSS. */
const NAME_WIDTH = 150;

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export default function CalendarClient({
  month,
  initialView,
  bookings,
  vehicles,
  role,
}: {
  month: MonthKey;
  initialView: View;
  bookings: BookingDTO[];
  vehicles: VehicleRow[];
  role: string;
}) {
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();

  const [view, setView] = useState<View>(initialView);
  const [showCancelled, setShowCancelled] = useState(false);
  const [moreDay, setMoreDay] = useState<string | null>(null);

  // Ο συνεργάτης βλέπει το ημερολόγιο, αλλά δεν επεξεργάζεται κρατήσεις —
  // ίδιος κανόνας με τη σελίδα Κρατήσεων.
  const canManage = role === "COMPANY_ADMIN" || role === "STAFF";

  const days = useMemo(() => monthDays(month), [month]);
  const grid = useMemo(() => monthGrid(month), [month]);
  const today = todayKey();

  // Οι ακυρωμένες κρύβονται από προεπιλογή: στο timeline θα έδειχναν
  // πιασμένο ένα όχημα που στην πραγματικότητα είναι ελεύθερο.
  const visible = useMemo(
    () => bookings.filter((b) => showCancelled || b.status !== "CANCELLED"),
    [bookings, showCancelled]
  );

  const goMonth = (next: MonthKey) => {
    router.push(`/dashboard/calendar?m=${next}&view=${view}`);
  };

  const changeView = (next: View) => {
    setView(next);
    // Η προβολή μένει στο URL, ώστε η πλοήγηση μήνα να μην την επαναφέρει.
    router.replace(`/dashboard/calendar?m=${month}&view=${next}`, {
      scroll: false,
    });
  };

  /**
   * Άνοιγμα της κράτησης εκεί όπου ζει η λογική της — στη σελίδα
   * Κρατήσεων. Δεν αντιγράφουμε ούτε φόρμα ούτε υπολογισμό τιμής.
   */
  const openBooking = (b: BookingDTO) => {
    router.push(`/dashboard/bookings?booking=${b.id}`);
  };

  return (
    <>
      <div className="dash-page-head dash-head-row">
        <div>
          <h1 className="dash-page-title">{tr("calendar.title")}</h1>
          <p className="dash-page-sub">{tr("calendar.subtitle")}</p>
        </div>
        <div className="dash-filters">
          <button
            className={`dash-filter ${view === "month" ? "active" : ""}`}
            onClick={() => changeView("month")}
            aria-pressed={view === "month"}
          >
            <CalendarDays size={15} /> {tr("calendar.viewMonth")}
          </button>
          <button
            className={`dash-filter ${view === "timeline" ? "active" : ""}`}
            onClick={() => changeView("timeline")}
            aria-pressed={view === "timeline"}
          >
            <Rows3 size={15} /> {tr("calendar.viewTimeline")}
          </button>
        </div>
      </div>

      <div className="dash-toolbar dash-cal-bar">
        <div className="dash-cal-nav">
          <button
            className="dash-icon-btn"
            onClick={() => goMonth(shiftMonth(month, -1))}
            aria-label={tr("calendar.prevMonth")}
            title={tr("calendar.prevMonth")}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="dash-cal-month">{monthLabel(month, locale)}</span>
          <button
            className="dash-icon-btn"
            onClick={() => goMonth(shiftMonth(month, 1))}
            aria-label={tr("calendar.nextMonth")}
            title={tr("calendar.nextMonth")}
          >
            <ChevronRight size={18} />
          </button>
          <button className="dash-btn" onClick={() => goMonth(currentMonth())}>
            {tr("calendar.today")}
          </button>
        </div>

        <div className="dash-cal-legend">
          {BOOKING_STATUSES.map((s) => (
            <span key={s} className="dash-cal-key">
              <i className={`dash-cal-dot dash-cal-dot--${BOOKING_STATUS_CLASS[s]}`} />
              {tr(`status.${s}`)}
            </span>
          ))}
          <label className="dash-cal-toggle">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)}
            />
            {tr("calendar.showCancelled")}
          </label>
        </div>
      </div>

      {visible.length === 0 && (
        <div className="dash-panel dash-empty">{tr("calendar.empty")}</div>
      )}

      {view === "month" ? (
        <div className="dash-panel dash-cal-panel">
          <div className="dash-cal-grid">
            {WEEKDAY_KEYS.map((k) => (
              <div key={k} className="dash-cal-head">
                {tr(`calendar.${k}`)}
              </div>
            ))}

            {grid.flat().map(({ day, inMonth }) => {
              const onDay = visible.filter((b) => coversDay(b, day));
              const shown = onDay.slice(0, CHIPS_PER_DAY);
              const rest = onDay.length - shown.length;

              return (
                <div
                  key={day}
                  className={`dash-cal-cell${inMonth ? "" : " muted"}${
                    day === today ? " today" : ""
                  }`}
                >
                  <span className="dash-cal-daynum">
                    {Number(day.slice(8))}
                  </span>
                  {shown.map((b) => (
                    <Chip key={b.id} booking={b} onClick={() => openBooking(b)} />
                  ))}
                  {rest > 0 && (
                    <button
                      className="dash-cal-more"
                      onClick={() => setMoreDay(day)}
                    >
                      +{rest} {tr("calendar.more")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <Timeline
          days={days}
          vehicles={vehicles}
          bookings={visible}
          tr={tr}
          today={today}
          onOpen={openBooking}
        />
      )}

      {!canManage && (
        <p className="dash-form-note">{tr("calendar.readOnlyNote")}</p>
      )}

      {moreDay && (
        <DayModal
          day={moreDay}
          locale={locale}
          tr={tr}
          bookings={visible.filter((b) => coversDay(b, moreDay))}
          onClose={() => setMoreDay(null)}
          onOpen={openBooking}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Chip κράτησης
   ───────────────────────────────────────────── */

function Chip({
  booking: b,
  onClick,
}: {
  booking: BookingDTO;
  onClick: () => void;
}) {
  return (
    <button
      className={`dash-cal-chip dash-cal-chip--${
        BOOKING_STATUS_CLASS[b.status] ?? "muted"
      }${b.status === "CANCELLED" ? " off" : ""}`}
      onClick={onClick}
      title={`${b.bookingNumber} · ${b.customerName} · ${b.vehicleName} ${b.vehiclePlate}`}
    >
      <span className="dash-cal-chip-who">{b.customerName}</span>
      <span className="dash-cal-chip-car">{b.vehiclePlate}</span>
    </button>
  );
}

/* ─────────────────────────────────────────────
   Timeline: ένα όχημα ανά γραμμή
   ───────────────────────────────────────────── */

function Timeline({
  days,
  vehicles,
  bookings,
  tr,
  today,
  onOpen,
}: {
  days: string[];
  vehicles: VehicleRow[];
  bookings: BookingDTO[];
  tr: (key: string) => string;
  today: string;
  onOpen: (b: BookingDTO) => void;
}) {
  const width = days.length * DAY_WIDTH;

  if (vehicles.length === 0) {
    return <div className="dash-panel dash-empty">{tr("calendar.noVehicles")}</div>;
  }

  return (
    <div className="dash-panel dash-cal-panel">
      <div className="dash-tl-scroll">
        <div className="dash-tl" style={{ width: width + NAME_WIDTH }}>
          <div className="dash-tl-row dash-tl-row--head">
            <div className="dash-tl-name">{tr("calendar.vehicle")}</div>
            <div className="dash-tl-track" style={{ width }}>
              {days.map((d) => (
                <div
                  key={d}
                  className={`dash-tl-day${d === today ? " today" : ""}`}
                  style={{ width: DAY_WIDTH }}
                >
                  {Number(d.slice(8))}
                </div>
              ))}
            </div>
          </div>

          {vehicles.map((v) => {
            const rows = bookings.filter((b) => b.vehicleId === v.id);
            return (
              <div key={v.id} className="dash-tl-row">
                <div className="dash-tl-name">
                  <Car size={14} />
                  <span>
                    <strong>{v.name}</strong>
                    <small>{v.plate}</small>
                  </span>
                </div>
                <div className="dash-tl-track" style={{ width }}>
                  {days.map((d) => (
                    <div
                      key={d}
                      className={`dash-tl-slot${d === today ? " today" : ""}`}
                      style={{ width: DAY_WIDTH }}
                    />
                  ))}

                  {rows.map((b) => {
                    const at = placeInRange(b, days);
                    if (!at) return null;
                    return (
                      <button
                        key={b.id}
                        className={`dash-tl-bar dash-tl-bar--${
                          BOOKING_STATUS_CLASS[b.status] ?? "muted"
                        }${b.status === "CANCELLED" ? " off" : ""}${
                          at.continuesBefore ? " open-start" : ""
                        }${at.continuesAfter ? " open-end" : ""}`}
                        style={{
                          left: at.startIndex * DAY_WIDTH + 2,
                          width: at.length * DAY_WIDTH - 4,
                        }}
                        onClick={() => onOpen(b)}
                        title={`${b.bookingNumber} · ${b.customerName} · ${b.pickupDate} → ${b.returnDate}`}
                      >
                        {b.customerName}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Όλες οι κρατήσεις μιας ημέρας
   ───────────────────────────────────────────── */

function DayModal({
  day,
  locale,
  tr,
  bookings,
  onClose,
  onOpen,
}: {
  day: string;
  locale: string;
  tr: (key: string) => string;
  bookings: BookingDTO[];
  onClose: () => void;
  onOpen: (b: BookingDTO) => void;
}) {
  const label = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "el-GR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00.000Z`));

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div
        className="dash-modal dash-modal--sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dash-modal-header">
          <h2>{label}</h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("calendar.close")}
          >
            ×
          </button>
        </div>
        <div className="dash-modal-body dash-cal-daylist">
          {bookings.map((b) => (
            <button
              key={b.id}
              className="dash-cal-dayitem"
              onClick={() => onOpen(b)}
            >
              <span
                className={`dash-cal-dot dash-cal-dot--${
                  BOOKING_STATUS_CLASS[b.status] ?? "muted"
                }`}
              />
              <span className="dash-cal-dayitem-main">
                <strong>{b.customerName}</strong>
                <small>
                  {b.bookingNumber} · {b.vehicleName} {b.vehiclePlate}
                </small>
              </span>
              <span
                className={`dash-status dash-status--${
                  BOOKING_STATUS_CLASS[b.status] ?? "muted"
                }`}
              >
                {tr(`status.${b.status}`)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
