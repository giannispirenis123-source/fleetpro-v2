"use client";

// Νέο συμβόλαιο (walk-in): όχημα, ημερομηνίες/ώρες και ζωντανή τιμή στην
// κορυφή του συμβολαίου. Τίποτα δεν γράφεται πριν την πρώτη «Αποθήκευση»·
// η τιμή έρχεται από τον server (ίδιος υπολογισμός με τις κρατήσεις) και
// ξαναϋπολογίζεται στην αποθήκευση.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Car } from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import type { BookingConflict } from "@/lib/bookings";
import type { WalkInPreview, WalkInVehicle } from "@/lib/walkIn";

const INTL: Record<string, string> = { el: "el-GR", en: "en-GB" };

export const eur = (n: number, locale: string) =>
  new Intl.NumberFormat(INTL[locale] ?? "el-GR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

const stampFromIso = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(INTL[locale] ?? "el-GR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(iso));

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export interface RentalWindow {
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
}

/** Παραλαβή = τώρα, στρογγυλοποιημένη προς τα πάνω στο τέταρτο· επιστροφή +1 ημέρα. */
function defaultWindow(): RentalWindow {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  const r = new Date(d);
  r.setDate(r.getDate() + 1);
  return { pickupDate: ymd(d), pickupTime: hm(d), returnDate: ymd(r), returnTime: hm(d) };
}

export const windowValid = (w: RentalWindow | null): w is RentalWindow =>
  !!w &&
  !!w.pickupDate &&
  !!w.pickupTime &&
  !!w.returnDate &&
  !!w.returnTime &&
  `${w.returnDate}T${w.returnTime}` > `${w.pickupDate}T${w.pickupTime}`;

/**
 * Η κατάσταση του walk-in: διάστημα, όχημα, κωδικός, συνεργάτης και η
 * προεπισκόπηση τιμής από τον server. `active = false` → καμία κλήση.
 */
export function useWalkInDraft(active: boolean, extraIds: string[], customerId: string | null) {
  const tr = useT();

  // Η «τώρα» μπαίνει μετά το mount: ο server δεν ξέρει την ώρα του χρήστη.
  const [win, setWin] = useState<RentalWindow | null>(null);
  const [vehicles, setVehicles] = useState<WalkInVehicle[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [preview, setPreview] = useState<WalkInPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  /** Αλλάζει για να ξαναδιαβαστεί η διαθεσιμότητα (π.χ. μετά από 409). */
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (active) setWin((w) => w ?? defaultWindow());
  }, [active]);

  /* ── Διαθέσιμα οχήματα για το διάστημα ── */
  const vehSeq = useRef(0);
  useEffect(() => {
    if (!active || !windowValid(win)) {
      setVehicles(null);
      return;
    }
    const mine = ++vehSeq.current;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ ...win, ...(showAll ? { all: "1" } : {}) });
        const res = await fetch(`/api/contracts/walk-in?${params}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (mine !== vehSeq.current) return;
        const list: WalkInVehicle[] = res.ok ? body.data.vehicles : [];
        setVehicles(list);
        // Το όχημα που είχε διαλεχτεί δεν είναι πια ελεύθερο → ξεδιάλεξέ το.
        setVehicleId((id) => (list.some((v) => v.id === id) ? id : ""));
      } catch {
        if (mine === vehSeq.current) setVehicles([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [active, win, showAll, reload]);

  /* ── Προεπισκόπηση τιμής από τον server ── */
  const prevSeq = useRef(0);
  const extrasKey = [...extraIds].sort().join(",");
  useEffect(() => {
    if (!active || !windowValid(win) || !vehicleId) {
      setPreview(null);
      return;
    }
    const mine = ++prevSeq.current;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/contracts/walk-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preview: true,
            ...(customerId ? { customerId } : {}),
            vehicleId,
            ...win,
            extraIds: extrasKey ? extrasKey.split(",") : [],
            discountMode: appliedCode ? "CODE" : "NONE",
            discountCode: appliedCode || null,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (mine !== prevSeq.current) return;
        if (!res.ok) {
          setPreview(null);
          if (appliedCode) {
            // Ο κωδικός δεν ισχύει: τον βγάζουμε και ξαναϋπολογίζεται χωρίς.
            setCodeError(body.message || tr("walkIn.codeInvalid"));
            setAppliedCode("");
          } else {
            setError(body.message || tr("contracts.errorLoad"));
          }
          return;
        }
        setError("");
        setPreview(body.data.preview);
      } catch {
        if (mine === prevSeq.current) setError(tr("contracts.errorConnection"));
      } finally {
        if (mine === prevSeq.current) setPreviewing(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [active, win, vehicleId, extrasKey, appliedCode, customerId, tr, reload]);

  const conflicts = (preview?.conflicts ?? []) as BookingConflict[];

  return {
    win,
    setWinField: (key: keyof RentalWindow, value: string) =>
      setWin((w) => (w ? { ...w, [key]: value } : w)),
    vehicles,
    showAll,
    setShowAll,
    vehicleId,
    setVehicleId,
    codeInput,
    setCodeInput: (v: string) => {
      setCodeInput(v);
      setCodeError("");
    },
    applyCode: () => {
      setCodeError("");
      setAppliedCode(codeInput.trim().toUpperCase());
    },
    appliedCode,
    codeError,
    partnerId,
    setPartnerId,
    preview,
    previewing,
    error,
    conflicts,
    hasConflict: conflicts.length > 0,
    ready: windowValid(win) && !!vehicleId && !!preview && !previewing,
    reloadAvailability: () => setReload((n) => n + 1),
    /** Τα πεδία της κράτησης για το POST (ο server ξαναϋπολογίζει τα πάντα). */
    bookingBody: (withPartner: boolean) => ({
      vehicleId,
      ...(win ?? {}),
      extraIds,
      discountMode: appliedCode ? "CODE" : "NONE",
      discountCode: appliedCode || null,
      ...(withPartner && partnerId ? { partnerId } : {}),
    }),
  };
}

export type WalkInDraft = ReturnType<typeof useWalkInDraft>;

/** Η ενότητα «Όχημα & ημερομηνίες» του νέου συμβολαίου. */
export function WalkInSection({
  draft,
  canOverride,
}: {
  draft: WalkInDraft;
  canOverride: boolean;
}) {
  const tr = useT();
  const locale = useLocale();
  const { win, vehicles, vehicleId } = draft;

  return (
    <>
      <div className="dash-form-grid dash-walkin-dates">
        <label className="dash-field">
          {tr("walkIn.pickupDate")} *
          <input
            type="date"
            value={win?.pickupDate ?? ""}
            onChange={(e) => draft.setWinField("pickupDate", e.target.value)}
          />
        </label>
        <label className="dash-field">
          {tr("walkIn.pickupTime")} *
          <input
            type="time"
            step={900}
            value={win?.pickupTime ?? ""}
            onChange={(e) => draft.setWinField("pickupTime", e.target.value)}
          />
        </label>
        <label className="dash-field">
          {tr("walkIn.returnDate")} *
          <input
            type="date"
            value={win?.returnDate ?? ""}
            min={win?.pickupDate}
            onChange={(e) => draft.setWinField("returnDate", e.target.value)}
          />
        </label>
        <label className="dash-field">
          {tr("walkIn.returnTime")} *
          <input
            type="time"
            step={900}
            value={win?.returnTime ?? ""}
            onChange={(e) => draft.setWinField("returnTime", e.target.value)}
          />
        </label>
      </div>
      {win && !windowValid(win) && <p className="dash-field-error">{tr("walkIn.returnAfterPickup")}</p>}

      <div className="dash-walkin-head">
        <h3 className="dash-contract-sub">{tr("walkIn.vehicle")} *</h3>
        {canOverride && (
          <label className="dash-field dash-field--check">
            <input
              type="checkbox"
              checked={draft.showAll}
              onChange={(e) => draft.setShowAll(e.target.checked)}
            />
            {tr("walkIn.showUnavailable")}
          </label>
        )}
      </div>
      {vehicles === null ? (
        <p className="dash-form-note">{windowValid(win) ? tr("contracts.loading") : "—"}</p>
      ) : vehicles.length === 0 ? (
        <p className="dash-form-note">{tr("walkIn.noVehicles")}</p>
      ) : (
        <div className="dash-extras-pick dash-walkin-vehicles">
          {vehicles.map((v) => (
            <label key={v.id} className={`dash-extra-pick ${vehicleId === v.id ? "on" : ""}`}>
              <input
                type="radio"
                name="vehicle"
                checked={vehicleId === v.id}
                onChange={() => draft.setVehicleId(v.id)}
              />
              <span className="dash-extra-pick-name">
                <Car size={13} /> {v.brand} {v.model}
                <small> · {v.plate}</small>
                {!v.available && <small className="dash-walkin-busy"> · {tr("walkIn.unavailable")}</small>}
              </span>
              <span className="dash-extra-pick-price">
                {eur(v.dailyRate, locale)}
                <small> {tr("contracts.perDay")}</small>
              </span>
            </label>
          ))}
        </div>
      )}

      {draft.hasConflict && (
        <div className="dash-conflict">
          <p className="dash-conflict-title">
            <AlertTriangle size={16} /> {tr("bookings.conflictTitle")}
          </p>
          <p className="dash-conflict-lead">{tr("bookings.conflictLead")}</p>
          <ul className="dash-conflict-list">
            {draft.conflicts.map((c) => (
              <li key={c.bookingId}>
                <strong>{c.bookingNumber}</strong>{" "}
                <span className={`dash-status dash-status--${c.kind === "OVERLAP" ? "bad" : "warn"}`}>
                  {c.kind === "OVERLAP" ? tr("bookings.conflictOverlap") : tr("bookings.conflictPrep")}
                </span>
                <span className="dash-conflict-times">
                  {tr("bookings.conflictReturnAt")} {stampFromIso(c.returnAt, locale)} ·{" "}
                  {tr("bookings.conflictReadyAt")} {stampFromIso(c.readyAt, locale)}
                </span>
              </li>
            ))}
          </ul>
          <p className="dash-conflict-note">
            {canOverride ? tr("bookings.conflictAdminNote") : tr("bookings.conflictStaffNote")}
          </p>
        </div>
      )}
      {draft.error && <div className="dash-form-error">{draft.error}</div>}
    </>
  );
}
