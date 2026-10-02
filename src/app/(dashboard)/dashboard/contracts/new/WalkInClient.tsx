"use client";

// «Νέο συμβόλαιο» για πελάτη στο γκισέ (walk-in): πελάτης, διάστημα,
// διαθέσιμο όχημα, πρόσθετα — και αμέσως η γνωστή φόρμα συμβολαίου.
//
// Η τιμή που φαίνεται έρχεται από τον server (ο ίδιος υπολογισμός με τις
// κρατήσεις). Στην αποθήκευση ο server φτιάχνει πελάτη + κράτηση +
// συμβόλαιο σε μία transaction και ξαναϋπολογίζει τα πάντα.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Car,
  FileSignature,
  Search,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import type { ExtraDTO } from "@/lib/extras";
import type { BookingConflict } from "@/lib/bookings";
import type { WalkInCustomer, WalkInPreview, WalkInVehicle } from "@/lib/walkIn";
import NewContractModal from "../NewContractModal";

const INTL: Record<string, string> = { el: "el-GR", en: "en-GB" };

const eur = (n: number, locale: string) =>
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

interface Window {
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
}

/** Παραλαβή = τώρα, στρογγυλοποιημένη προς τα πάνω στο τέταρτο· επιστροφή +1 ημέρα. */
function defaultWindow(): Window {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  const r = new Date(d);
  r.setDate(r.getDate() + 1);
  return { pickupDate: ymd(d), pickupTime: hm(d), returnDate: ymd(r), returnTime: hm(d) };
}

const windowValid = (w: Window | null): w is Window =>
  !!w &&
  !!w.pickupDate &&
  !!w.pickupTime &&
  !!w.returnDate &&
  !!w.returnTime &&
  `${w.returnDate}T${w.returnTime}` > `${w.pickupDate}T${w.pickupTime}`;

type NewCustomer = { firstName: string; lastName: string; phone: string; email: string };
const EMPTY_NEW: NewCustomer = { firstName: "", lastName: "", phone: "", email: "" };

export default function WalkInClient({
  extras,
  partners,
  canOverride,
}: {
  extras: ExtraDTO[];
  /** Κενό για συνεργάτη: χρεώνεται πάντα ο ίδιος. */
  partners: { id: string; name: string }[];
  canOverride: boolean;
}) {
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();

  /* ── Πελάτης ── */
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<WalkInCustomer[] | null>(null);
  const [customer, setCustomer] = useState<WalkInCustomer | null>(null);
  const [fresh, setFresh] = useState<NewCustomer>(EMPTY_NEW);
  const [suggested, setSuggested] = useState<WalkInCustomer[]>([]);
  /** Ο server βρήκε υπάρχοντα πελάτη με το ίδιο τηλέφωνο/email. */
  const [duplicates, setDuplicates] = useState<WalkInCustomer[] | null>(null);

  /* ── Διάστημα & όχημα ── */
  // Η «τώρα» μπαίνει μετά το mount: ο server δεν ξέρει την ώρα του χρήστη.
  const [win, setWin] = useState<Window | null>(null);
  const [vehicles, setVehicles] = useState<WalkInVehicle[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [vehicleId, setVehicleId] = useState("");

  /* ── Τιμή ── */
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [preview, setPreview] = useState<WalkInPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fromBooking, setFromBooking] = useState(false);

  useEffect(() => setWin(defaultWindow()), []);

  /* ── Αναζήτηση πελάτη (debounce) ── */
  const searchSeq = useRef(0);
  useEffect(() => {
    if (mode !== "existing" || customer) return;
    const mine = ++searchSeq.current;
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contracts/walk-in/customers?q=${encodeURIComponent(term)}`, {
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (mine !== searchSeq.current) return;
        setResults(res.ok ? body.data.customers : []);
      } catch {
        if (mine === searchSeq.current) setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, mode, customer]);

  /* ── Πιθανός διπλότυπος όσο γράφεται νέος πελάτης ── */
  const dupSeq = useRef(0);
  useEffect(() => {
    if (mode !== "new") return;
    const mine = ++dupSeq.current;
    const phone = fresh.phone.trim();
    const email = fresh.email.trim();
    if (phone.replace(/\D/g, "").length < 7 && !email.includes("@")) {
      setSuggested([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ phone, email });
        const res = await fetch(`/api/contracts/walk-in/customers?${params}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (mine === dupSeq.current) setSuggested(res.ok ? body.data.customers : []);
      } catch {
        if (mine === dupSeq.current) setSuggested([]);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [fresh.phone, fresh.email, mode]);

  /* ── Διαθέσιμα οχήματα για το διάστημα ── */
  const vehSeq = useRef(0);
  useEffect(() => {
    if (!windowValid(win)) {
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
  }, [win, showAll]);

  /* ── Προεπισκόπηση τιμής από τον server ── */
  const prevSeq = useRef(0);
  const extrasKey = [...extraIds].sort().join(",");
  useEffect(() => {
    if (!windowValid(win) || !vehicleId) {
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
            ...(mode === "existing" && customer ? { customerId: customer.id } : {}),
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
        setPreview(body.data.preview);
      } catch {
        if (mine === prevSeq.current) setError(tr("contracts.errorConnection"));
      } finally {
        if (mine === prevSeq.current) setPreviewing(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [win, vehicleId, extrasKey, appliedCode, mode, customer, tr]);

  const conflicts = (preview?.conflicts ?? []) as BookingConflict[];
  const hasConflict = conflicts.length > 0;

  const customerReady =
    mode === "existing"
      ? customer !== null
      : !!fresh.firstName.trim() && !!fresh.lastName.trim() && fresh.phone.trim().length >= 5;
  const canSave =
    customerReady && windowValid(win) && !!vehicleId && !!preview && !previewing && !saving;

  const setWinField = (key: keyof Window, value: string) => {
    setError("");
    setWin((w) => (w ? { ...w, [key]: value } : w));
  };

  const pickCustomer = (c: WalkInCustomer) => {
    setMode("existing");
    setCustomer(c);
    setDuplicates(null);
    setSuggested([]);
    setError("");
  };

  const toggleExtra = (id: string, on: boolean) =>
    setExtraIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));

  const applyCode = () => {
    setCodeError("");
    setAppliedCode(codeInput.trim().toUpperCase());
  };

  /** override = ο διαχειριστής είδε τη σύγκρουση και την εγκρίνει. */
  const save = async (opts: { override?: boolean; allowDuplicate?: boolean } = {}) => {
    if (!windowValid(win) || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/contracts/walk-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(mode === "existing"
            ? { customerId: customer?.id }
            : {
                newCustomer: {
                  firstName: fresh.firstName.trim(),
                  lastName: fresh.lastName.trim(),
                  phone: fresh.phone.trim(),
                  email: fresh.email.trim(),
                },
                allowDuplicate: opts.allowDuplicate ?? false,
              }),
          vehicleId,
          ...win,
          extraIds,
          discountMode: appliedCode ? "CODE" : "NONE",
          discountCode: appliedCode || null,
          ...(partners.length > 0 && partnerId ? { partnerId } : {}),
          override: opts.override ?? false,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.conflicts?.duplicates) {
        setDuplicates(body.conflicts.duplicates);
        return;
      }
      if (!res.ok) {
        setError(body.message || tr("contracts.errorSave"));
        // Το όχημα πιάστηκε στο μεταξύ: ξαναδιάβασε τη διαθεσιμότητα.
        if (res.status === 409) setWin((w) => (w ? { ...w } : w));
        return;
      }
      router.push(`/dashboard/contracts/${body.data.id}`);
    } catch {
      setError(tr("contracts.errorConnection"));
    } finally {
      setSaving(false);
    }
  };

  const extraLines = preview?.lines.filter((l) => l.type !== "INSURANCE") ?? [];
  const insuranceLines = preview?.lines.filter((l) => l.type === "INSURANCE") ?? [];

  return (
    <div className="dash-contract">
      {/* ── Κεφαλίδα ── */}
      <div className="dash-page-head">
        <Link href="/dashboard/contracts" className="dash-back">
          <ArrowLeft size={15} /> {tr("contracts.backToList")}
        </Link>
        <h1 className="dash-page-title">{tr("walkIn.title")}</h1>
        <p className="dash-page-sub">{tr("walkIn.subtitle")}</p>
        <button type="button" className="dash-link-btn" onClick={() => setFromBooking(true)}>
          <FileSignature size={14} /> {tr("walkIn.fromBooking")}
        </button>
      </div>

      {/* ── Πελάτης ── */}
      <section className="dash-panel dash-contract-section">
        <div className="dash-walkin-head">
          <h2 className="dash-section-title">{tr("walkIn.customer")}</h2>
          <div className="dash-filters">
            <button
              type="button"
              className={`dash-filter ${mode === "existing" ? "active" : ""}`}
              aria-pressed={mode === "existing"}
              onClick={() => setMode("existing")}
            >
              <UserRound size={14} /> {tr("walkIn.existing")}
            </button>
            <button
              type="button"
              className={`dash-filter ${mode === "new" ? "active" : ""}`}
              aria-pressed={mode === "new"}
              onClick={() => {
                setMode("new");
                setDuplicates(null);
              }}
            >
              <UserPlus size={14} /> {tr("walkIn.newCustomer")}
            </button>
          </div>
        </div>

        {mode === "existing" ? (
          customer ? (
            <div className="dash-walkin-chosen">
              <span>
                <strong>{customer.name}</strong>
                {customer.phone && ` · ${customer.phone}`}
                {customer.email && ` · ${customer.email}`}
                {customer.isBlacklisted && (
                  <span className="dash-status dash-status--bad">{tr("walkIn.blacklisted")}</span>
                )}
              </span>
              <button
                type="button"
                className="dash-icon-btn"
                onClick={() => setCustomer(null)}
                aria-label={tr("walkIn.changeCustomer")}
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <>
              <label className="dash-field dash-contract-search">
                <Search size={15} />
                <input
                  autoFocus
                  value={q}
                  placeholder={tr("walkIn.customerSearch")}
                  onChange={(e) => setQ(e.target.value)}
                />
              </label>
              {results !== null &&
                (results.length === 0 ? (
                  <p className="dash-form-note">
                    {tr("walkIn.noCustomer")}{" "}
                    <button type="button" className="dash-link-btn" onClick={() => setMode("new")}>
                      {tr("walkIn.createNew")}
                    </button>
                  </p>
                ) : (
                  <div className="dash-pick-list">
                    {results.map((c) => (
                      <CustomerPick key={c.id} c={c} onPick={pickCustomer} />
                    ))}
                  </div>
                ))}
            </>
          )
        ) : (
          <>
            <div className="dash-form-grid">
              <label className="dash-field">
                {tr("walkIn.firstName")} *
                <input
                  value={fresh.firstName}
                  maxLength={100}
                  onChange={(e) => setFresh({ ...fresh, firstName: e.target.value })}
                />
              </label>
              <label className="dash-field">
                {tr("walkIn.lastName")} *
                <input
                  value={fresh.lastName}
                  maxLength={100}
                  onChange={(e) => setFresh({ ...fresh, lastName: e.target.value })}
                />
              </label>
              <label className="dash-field">
                {tr("walkIn.phone")} *
                <input
                  type="tel"
                  value={fresh.phone}
                  maxLength={40}
                  onChange={(e) => {
                    setFresh({ ...fresh, phone: e.target.value });
                    setDuplicates(null);
                  }}
                />
              </label>
              <label className="dash-field">
                {tr("walkIn.email")}
                <input
                  type="email"
                  value={fresh.email}
                  maxLength={200}
                  onChange={(e) => {
                    setFresh({ ...fresh, email: e.target.value });
                    setDuplicates(null);
                  }}
                />
              </label>
            </div>
            {(duplicates ?? suggested).length > 0 && (
              <div className="dash-contract-warn dash-walkin-dup">
                <p>
                  <AlertTriangle size={15} /> {tr("walkIn.duplicateFound")}
                </p>
                <div className="dash-pick-list">
                  {(duplicates ?? suggested).map((c) => (
                    <CustomerPick key={c.id} c={c} onPick={pickCustomer} useLabel={tr("walkIn.useThis")} />
                  ))}
                </div>
                {duplicates && (
                  <button
                    type="button"
                    className="dash-btn"
                    disabled={saving}
                    onClick={() => save({ allowDuplicate: true })}
                  >
                    {tr("walkIn.createAnyway")}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Διάστημα ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">{tr("walkIn.period")}</h2>
        <div className="dash-form-grid">
          <label className="dash-field">
            {tr("walkIn.pickupDate")}
            <input
              type="date"
              value={win?.pickupDate ?? ""}
              onChange={(e) => setWinField("pickupDate", e.target.value)}
            />
          </label>
          <label className="dash-field">
            {tr("walkIn.pickupTime")}
            <input
              type="time"
              step={900}
              value={win?.pickupTime ?? ""}
              onChange={(e) => setWinField("pickupTime", e.target.value)}
            />
          </label>
          <label className="dash-field">
            {tr("walkIn.returnDate")}
            <input
              type="date"
              value={win?.returnDate ?? ""}
              min={win?.pickupDate}
              onChange={(e) => setWinField("returnDate", e.target.value)}
            />
          </label>
          <label className="dash-field">
            {tr("walkIn.returnTime")}
            <input
              type="time"
              step={900}
              value={win?.returnTime ?? ""}
              onChange={(e) => setWinField("returnTime", e.target.value)}
            />
          </label>
        </div>
        {win && !windowValid(win) && (
          <p className="dash-field-error">{tr("walkIn.returnAfterPickup")}</p>
        )}
      </section>

      {/* ── Όχημα ── */}
      <section className="dash-panel dash-contract-section">
        <div className="dash-walkin-head">
          <h2 className="dash-section-title">{tr("walkIn.vehicle")}</h2>
          {canOverride && (
            <label className="dash-field dash-field--check">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
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
          <div className="dash-extras-pick">
            {vehicles.map((v) => (
              <label
                key={v.id}
                className={`dash-extra-pick ${vehicleId === v.id ? "on" : ""}`}
              >
                <input
                  type="radio"
                  name="vehicle"
                  checked={vehicleId === v.id}
                  onChange={() => {
                    setVehicleId(v.id);
                    setError("");
                  }}
                />
                <span className="dash-extra-pick-name">
                  <Car size={13} /> {v.brand} {v.model}
                  <small> · {v.plate}</small>
                  {!v.available && (
                    <small className="dash-walkin-busy"> · {tr("walkIn.unavailable")}</small>
                  )}
                </span>
                <span className="dash-extra-pick-price">
                  {eur(v.dailyRate, locale)}
                  <small> {tr("contracts.perDay")}</small>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      {/* ── Πρόσθετα / ασφάλεια ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">{tr("contracts.extras")}</h2>
        {extras.length === 0 ? (
          <p className="dash-form-note">{tr("contracts.noExtras")}</p>
        ) : (
          <div className="dash-extras-pick">
            {extras.map((e) => {
              const checked = extraIds.includes(e.id);
              return (
                <label key={e.id} className={`dash-extra-pick ${checked ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(ev) => toggleExtra(e.id, ev.target.checked)}
                  />
                  <span className="dash-extra-pick-name">
                    {e.name}
                    {e.type === "INSURANCE" && <small> · {tr("contracts.insuranceTag")}</small>}
                  </span>
                  <span className="dash-extra-pick-price">
                    {eur(e.price, locale)}
                    <small>
                      {" "}
                      {e.chargeType === "PER_DAY" ? tr("contracts.perDay") : tr("contracts.oneOff")}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        <div className="dash-form-grid dash-walkin-extra-fields">
          <div className="dash-field">
            {tr("walkIn.discountCode")}
            <div className="dash-code-row">
              <input
                value={codeInput}
                maxLength={50}
                onChange={(e) => {
                  setCodeInput(e.target.value);
                  setCodeError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && applyCode()}
              />
              <button type="button" className="dash-btn" onClick={applyCode} disabled={!codeInput.trim()}>
                {tr("walkIn.applyCode")}
              </button>
            </div>
            {codeError && <span className="dash-field-error">{codeError}</span>}
            {appliedCode && !codeError && preview?.discountCode && (
              <span className="dash-form-note">
                {tr("walkIn.codeApplied")} {preview.discountCode}
              </span>
            )}
          </div>
          {partners.length > 0 && (
            <label className="dash-field">
              {tr("walkIn.partner")}
              <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">{tr("walkIn.noPartner")}</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      {/* ── Χρεώσεις (από τον server) ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">{tr("contracts.charges")}</h2>
        {preview ? (
          <div className="dash-contract-money">
            <div className="dash-contract-line">
              <span>
                {tr("contracts.rental")} · {preview.totalDays} × {eur(preview.dailyRate, locale)}
              </span>
              <span>{eur(preview.display.subtotal, locale)}</span>
            </div>
            {extraLines.map((x, i) => (
              <div key={`x${i}`} className="dash-contract-line">
                <span>{x.name}</span>
                <span>{eur(x.lineTotal, locale)}</span>
              </div>
            ))}
            {insuranceLines.map((x, i) => (
              <div key={`i${i}`} className="dash-contract-line">
                <span>
                  {x.name} <small>· {tr("contracts.insuranceTag")}</small>
                </span>
                <span>{eur(x.lineTotal, locale)}</span>
              </div>
            ))}
            {preview.display.discountAmount > 0 && (
              <div className="dash-contract-line">
                <span>{tr("contracts.discount")}</span>
                <span>−{eur(preview.display.discountAmount, locale)}</span>
              </div>
            )}
            <div className="dash-contract-line dash-contract-total">
              <span>{tr("contracts.total")}</span>
              <span>{eur(preview.display.total, locale)}</span>
            </div>
            <p className="dash-contract-vat">
              {tr("contracts.ofWhich")}: {tr("contracts.net")} {eur(preview.vat.net, locale)} +{" "}
              {tr("contracts.vat")} {preview.vat.vatRate}% {eur(preview.vat.vatAmount, locale)}
            </p>
            <p className="dash-form-note">{tr("walkIn.priceNote")}</p>
          </div>
        ) : (
          <p className="dash-form-note">
            {previewing ? tr("contracts.loading") : tr("walkIn.pickVehicleFirst")}
          </p>
        )}

        {hasConflict && (
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
                    className={`dash-status dash-status--${c.kind === "OVERLAP" ? "bad" : "warn"}`}
                  >
                    {c.kind === "OVERLAP"
                      ? tr("bookings.conflictOverlap")
                      : tr("bookings.conflictPrep")}
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

        {error && <div className="dash-form-error">{error}</div>}

        <div className="dash-contract-actions dash-walkin-actions">
          <Link href="/dashboard/contracts" className="dash-btn">
            {tr("contracts.cancel")}
          </Link>
          {hasConflict ? (
            canOverride && (
              <button
                type="button"
                className="dash-btn dash-btn--danger"
                disabled={!canSave}
                onClick={() => save({ override: true })}
              >
                {saving ? tr("walkIn.saving") : tr("bookings.conflictApprove")}
              </button>
            )
          ) : (
            <button
              type="button"
              className="dash-btn dash-btn--primary"
              disabled={!canSave}
              onClick={() => save()}
            >
              <FileSignature size={16} /> {saving ? tr("walkIn.saving") : tr("walkIn.create")}
            </button>
          )}
        </div>
        <p className="dash-form-note">{tr("walkIn.createNote")}</p>
      </section>

      {fromBooking && <NewContractModal onClose={() => setFromBooking(false)} />}
    </div>
  );
}

function CustomerPick({
  c,
  onPick,
  useLabel,
}: {
  c: WalkInCustomer;
  onPick: (c: WalkInCustomer) => void;
  useLabel?: string;
}) {
  const tr = useT();
  return (
    <button type="button" className="dash-pick" onClick={() => onPick(c)}>
      <span className="dash-pick-main">
        <strong>{c.name}</strong>
        {c.isBlacklisted && (
          <>
            {" "}
            <span className="dash-status dash-status--bad">{tr("walkIn.blacklisted")}</span>
          </>
        )}
        {useLabel && <> · {useLabel}</>}
      </span>
      <span className="dash-pick-sub">
        {[c.phone, c.email].filter(Boolean).join(" · ") || "—"}
      </span>
    </button>
  );
}
