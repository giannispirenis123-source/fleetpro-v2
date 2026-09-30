"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Printer,
  PenLine,
  Eraser,
  Lock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Save,
  X,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  CONTRACT_STATUS_CLASS,
  DEPOSIT_METHODS,
  GDPR_TEXT,
  ID_TYPES,
  PAYMENT_METHODS,
  allSigned,
  anySigned,
  emptyDriver,
  licenseExpiresBeforeReturn,
  randomId,
  type ContractDTO,
  type ContractDriver,
  type DamageMark,
} from "@/lib/contracts";
import DamageSketch from "@/components/contracts/DamageSketch";
import FuelGauge from "@/components/contracts/FuelGauge";
import SignaturePad from "@/components/contracts/SignaturePad";

const INTL: Record<string, string> = { el: "el-GR", en: "en-GB" };

const eur = (n: number, locale: string) =>
  new Intl.NumberFormat(INTL[locale] ?? "el-GR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

const shortDate = (iso: string, locale: string) =>
  iso
    ? new Intl.DateTimeFormat(INTL[locale] ?? "el-GR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${iso.slice(0, 10)}T00:00:00.000Z`))
    : "—";

const today = () => new Date().toISOString().slice(0, 10);

export interface VehicleOption {
  id: string;
  label: string;
}

/* ─────────────────────────────────────────────
   Η κατάσταση της φόρμας
   ───────────────────────────────────────────── */

interface ChangeRow {
  id: string;
  vehicleId: string;
  date: string;
}

interface FormState {
  drivers: ContractDriver[];
  pickupLocation: string;
  returnLocation: string;
  fuelPickup: number | null;
  fuelReturn: number | null;
  damageMarks: DamageMark[];
  vehicleChanges: ChangeRow[];
  notes: string;
  paymentMethod: string;
  depositAmount: string;
  depositMethod: string;
  gdprConsent: boolean;
}

const fromContract = (c: ContractDTO): FormState => ({
  drivers: c.drivers,
  pickupLocation: c.pickupLocation,
  returnLocation: c.returnLocation,
  fuelPickup: c.fuelPickup,
  fuelReturn: c.fuelReturn,
  damageMarks: c.damageMarks,
  vehicleChanges: c.vehicleChanges.map((v) => ({ id: v.id, vehicleId: v.vehicleId, date: v.date })),
  notes: c.notes,
  paymentMethod: c.paymentMethod ?? "",
  depositAmount: c.depositAmount === null ? "" : String(c.depositAmount),
  depositMethod: c.depositMethod ?? "",
  gdprConsent: c.gdprConsent,
});

/** Τα στοιχεία παραλαβής — ό,τι κλειδώνει με την υπογραφή όλων. */
const pickupPart = (f: FormState) =>
  JSON.stringify({
    drivers: f.drivers.map(({ signature: _s, signedAt: _a, ...rest }) => rest),
    pickupLocation: f.pickupLocation,
    returnLocation: f.returnLocation,
    fuelPickup: f.fuelPickup,
    damageMarks: f.damageMarks,
    paymentMethod: f.paymentMethod,
    depositAmount: f.depositAmount,
    depositMethod: f.depositMethod,
    gdprConsent: f.gdprConsent,
  });

const afterPart = (f: FormState) =>
  JSON.stringify({ fuelReturn: f.fuelReturn, vehicleChanges: f.vehicleChanges, notes: f.notes });

/** Το σώμα του PATCH. Σε υπογεγραμμένο στέλνουμε μόνο ό,τι επιτρέπεται. */
function toPayload(f: FormState, locked: boolean) {
  const after = {
    fuelReturn: f.fuelReturn,
    vehicleChanges: f.vehicleChanges,
    notes: f.notes,
  };
  if (locked) return after;
  return {
    ...after,
    drivers: f.drivers.map(({ signature: _s, signedAt: _a, ...rest }) => rest),
    pickupLocation: f.pickupLocation,
    returnLocation: f.returnLocation,
    fuelPickup: f.fuelPickup,
    damageMarks: f.damageMarks,
    paymentMethod: f.paymentMethod || null,
    depositAmount: f.depositAmount.trim() === "" ? null : Number(f.depositAmount),
    depositMethod: f.depositMethod || null,
    gdprConsent: f.gdprConsent,
  };
}

/* ─────────────────────────────────────────────
   Σελίδα
   ───────────────────────────────────────────── */

export default function ContractEditor({
  initialContract,
  vehicles,
  can,
}: {
  initialContract: ContractDTO;
  vehicles: VehicleOption[];
  can: { edit: boolean; delete: boolean };
}) {
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();

  const [contract, setContract] = useState(initialContract);
  const [form, setForm] = useState<FormState>(() => fromContract(initialContract));
  const saved = useMemo(() => fromContract(contract), [contract]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [signing, setSigning] = useState<ContractDriver | null>(null);
  const [selectedMark, setSelectedMark] = useState<string | null>(null);
  const [openChanges, setOpenChanges] = useState(initialContract.vehicleChanges.length > 0);
  const [openNotes, setOpenNotes] = useState(initialContract.notes.trim() !== "");
  const [openTerms, setOpenTerms] = useState(false);

  const s = contract.snapshot;
  const completed = contract.status === "COMPLETED";
  const locked = contract.status !== "DRAFT";
  const readOnly = !can.edit || completed;
  const pickupReadOnly = readOnly || locked;
  const electric = s?.vehicle.fuel === "ELECTRIC";
  const fuelWord = electric ? tr("contracts.battery") : tr("contracts.fuel");

  const pickupDirty = pickupPart(form) !== pickupPart(saved);
  const dirty = pickupDirty || afterPart(form) !== afterPart(saved);
  const hasSignatures = anySigned(contract.drivers);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setNotice("");
  };

  const setDriver = (id: string, key: keyof ContractDriver, value: string) =>
    setForm((f) => ({
      ...f,
      drivers: f.drivers.map((d) => (d.id === id ? { ...d, [key]: value } : d)),
    }));

  /* ── Αποθήκευση ── */
  const save = async (force = false) => {
    if (busy || !dirty) return;
    if (!force && !locked && pickupDirty && hasSignatures) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/contracts/${contract.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(form, locked)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("contracts.errorSave"));
        return;
      }
      setContract(data.data.contract);
      setForm(fromContract(data.data.contract));
      setNotice(data.data.signaturesReset ? tr("contracts.signaturesWereReset") : tr("contracts.saved"));
      router.refresh();
    } catch {
      setError(tr("contracts.errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  /* ── Υπογραφή ── */
  const sign = async (driverId: string, signature: string | null) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/contracts/${contract.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId, signature }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("contracts.errorSave"));
        return;
      }
      const next: ContractDTO = data.data.contract;
      setContract(next);
      setForm(fromContract(next));
      setSigning(null);
      if (next.status === "SIGNED") setNotice(tr("contracts.allSignedNotice"));
      router.refresh();
    } catch {
      setError(tr("contracts.errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/contracts/${contract.id}/complete`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("contracts.errorSave"));
        return;
      }
      setContract(data.data.contract);
      setForm(fromContract(data.data.contract));
      setNotice(tr("contracts.completedNotice"));
      router.refresh();
    } catch {
      setError(tr("contracts.errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/contracts/${contract.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || tr("contracts.errorSave"));
        setConfirmDelete(false);
        return;
      }
      router.push("/dashboard/contracts");
      router.refresh();
    } catch {
      setError(tr("contracts.errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  /* ── Οδηγοί ── */
  const addDriver = () =>
    setForm((f) => ({ ...f, drivers: [...f.drivers, emptyDriver(randomId())] }));
  const removeDriver = (id: string) =>
    setForm((f) => ({ ...f, drivers: f.drivers.filter((d) => d.id !== id) }));

  /* ── Σημάδια ζημιών ── */
  const addMark = (x: number, y: number) => {
    const mark = { id: randomId(), x, y, note: "" };
    setForm((f) => ({ ...f, damageMarks: [...f.damageMarks, mark] }));
    setSelectedMark(mark.id);
  };
  const setMarkNote = (id: string, note: string) =>
    setForm((f) => ({
      ...f,
      damageMarks: f.damageMarks.map((m) => (m.id === id ? { ...m, note } : m)),
    }));
  const removeMark = (id: string) =>
    setForm((f) => ({ ...f, damageMarks: f.damageMarks.filter((m) => m.id !== id) }));

  /* ── Αλλαγές οχήματος ── */
  const addChange = () =>
    setForm((f) => ({
      ...f,
      vehicleChanges: [...f.vehicleChanges, { id: randomId(), vehicleId: "", date: today() }],
    }));
  const setChange = (id: string, key: "vehicleId" | "date", value: string) =>
    setForm((f) => ({
      ...f,
      vehicleChanges: f.vehicleChanges.map((c) => (c.id === id ? { ...c, [key]: value } : c)),
    }));
  const removeChange = (id: string) =>
    setForm((f) => ({ ...f, vehicleChanges: f.vehicleChanges.filter((c) => c.id !== id) }));

  const changesIncomplete = form.vehicleChanges.some((c) => !c.vehicleId || !c.date);
  const returnDate = s?.booking.returnDate ?? "";
  const signedCount = contract.drivers.filter((d) => d.signature).length;
  const canSignNow = !readOnly && !locked && !dirty && form.gdprConsent;

  return (
    <div className="dash-contract">
      {/* ── Κεφαλίδα ── */}
      <div className="dash-page-head dash-head-row">
        <div>
          <Link href="/dashboard/contracts" className="dash-back">
            <ArrowLeft size={15} /> {tr("contracts.backToList")}
          </Link>
          <h1 className="dash-page-title">
            {tr("contracts.contract")} {contract.contractNumber}
          </h1>
          <p className="dash-page-sub">
            <span className={`dash-status dash-status--${CONTRACT_STATUS_CLASS[contract.status]}`}>
              {tr(`contracts.status_${contract.status}`)}
            </span>{" "}
            · {tr("contracts.booking")} {contract.bookingNumber} · {tr("contracts.issuedBy")}{" "}
            {contract.createdByName ?? "—"}
          </p>
        </div>
        <div className="dash-contract-actions">
          <a
            className="dash-btn"
            href={`/print/contracts/${contract.id}`}
            target="_blank"
            rel="noopener"
          >
            <Printer size={16} /> {tr("contracts.print")}
          </a>
          {can.delete && contract.status === "DRAFT" && !hasSignatures && (
            <button className="dash-btn dash-btn--danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={16} /> {tr("contracts.delete")}
            </button>
          )}
        </div>
      </div>

      {locked && (
        <div className="dash-contract-lock">
          <Lock size={15} />{" "}
          {completed ? tr("contracts.lockedCompleted") : tr("contracts.lockedSigned")}
        </div>
      )}
      {!readOnly && !locked && hasSignatures && (
        <div className="dash-contract-warn">
          <AlertTriangle size={15} /> {tr("contracts.partialSignedWarn")}
        </div>
      )}

      {/* ── Οδηγοί ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">{tr("contracts.drivers")}</h2>
        {form.drivers.map((d, i) => {
          const expiring = licenseExpiresBeforeReturn(d.licenseExpiry, returnDate);
          return (
            <div key={d.id} className="dash-driver">
              <div className="dash-driver-head">
                <strong>
                  {i === 0 ? tr("contracts.mainDriver") : `${tr("contracts.driver")} ${i + 1}`}
                </strong>
                {d.signature && (
                  <span className="dash-status dash-status--ok">{tr("contracts.signed")}</span>
                )}
                {i > 0 && !pickupReadOnly && (
                  <button
                    className="dash-icon-btn"
                    onClick={() => removeDriver(d.id)}
                    aria-label={tr("contracts.removeDriver")}
                    title={tr("contracts.removeDriver")}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="dash-form-grid">
                <label className="dash-field">
                  {tr("contracts.fullName")} *
                  <input
                    value={d.fullName}
                    disabled={pickupReadOnly}
                    onChange={(e) => setDriver(d.id, "fullName", e.target.value)}
                  />
                </label>
                <label className="dash-field">
                  {tr("contracts.country")}
                  <input
                    value={d.country}
                    disabled={pickupReadOnly}
                    onChange={(e) => setDriver(d.id, "country", e.target.value)}
                  />
                </label>
                <label className="dash-field">
                  {tr("contracts.licenseNumber")}
                  <input
                    value={d.licenseNumber}
                    disabled={pickupReadOnly}
                    onChange={(e) => setDriver(d.id, "licenseNumber", e.target.value)}
                  />
                </label>
                <label className="dash-field">
                  {tr("contracts.licenseExpiry")}
                  <input
                    type="date"
                    value={d.licenseExpiry}
                    disabled={pickupReadOnly}
                    onChange={(e) => setDriver(d.id, "licenseExpiry", e.target.value)}
                  />
                </label>
                <label className="dash-field">
                  {tr("contracts.birthDate")}
                  <input
                    type="date"
                    value={d.birthDate}
                    disabled={pickupReadOnly}
                    onChange={(e) => setDriver(d.id, "birthDate", e.target.value)}
                  />
                </label>
                <label className="dash-field">
                  {tr("contracts.idType")}
                  <select
                    value={d.idType}
                    disabled={pickupReadOnly}
                    onChange={(e) => setDriver(d.id, "idType", e.target.value)}
                  >
                    {ID_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {tr(`contracts.idType_${t}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="dash-field">
                  {tr("contracts.idNumber")}
                  <input
                    value={d.idNumber}
                    disabled={pickupReadOnly}
                    onChange={(e) => setDriver(d.id, "idNumber", e.target.value)}
                  />
                </label>
                <label className="dash-field">
                  {tr("contracts.phone")}
                  <input
                    type="tel"
                    value={d.phone}
                    disabled={pickupReadOnly}
                    onChange={(e) => setDriver(d.id, "phone", e.target.value)}
                  />
                </label>
                <label className="dash-field">
                  {tr("contracts.email")}
                  <input
                    type="email"
                    value={d.email}
                    disabled={pickupReadOnly}
                    onChange={(e) => setDriver(d.id, "email", e.target.value)}
                  />
                </label>
                <label className="dash-field dash-field--wide">
                  {tr("contracts.address")}
                  <input
                    value={d.address}
                    disabled={pickupReadOnly}
                    onChange={(e) => setDriver(d.id, "address", e.target.value)}
                  />
                </label>
              </div>
              {expiring && (
                <div className="dash-contract-warn">
                  <AlertTriangle size={15} /> {tr("contracts.licenseExpiresWarn")}{" "}
                  ({shortDate(returnDate, locale)})
                </div>
              )}
            </div>
          );
        })}
        {!pickupReadOnly && (
          <button className="dash-btn" onClick={addDriver}>
            <Plus size={16} /> {tr("contracts.addDriver")}
          </button>
        )}
      </section>

      {/* ── Όχημα, παραλαβή, παράδοση ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">{tr("contracts.vehicle")}</h2>
        <p className="dash-contract-vehicle">
          <strong>{s ? `${s.vehicle.brand} ${s.vehicle.model}` : "—"}</strong> · {s?.vehicle.plate ?? "—"} ·{" "}
          {s ? tr(`fuelType.${s.vehicle.fuel}`) : "—"}
        </p>

        <div className="dash-contract-cols">
          <div>
            <h3 className="dash-contract-sub">{tr("contracts.pickup")}</h3>
            <p className="dash-form-note">
              {s ? `${shortDate(s.booking.pickupDate, locale)} ${s.booking.pickupTime ?? ""}` : "—"}
            </p>
            <label className="dash-field">
              {tr("contracts.location")}
              <input
                value={form.pickupLocation}
                disabled={pickupReadOnly}
                onChange={(e) => set("pickupLocation", e.target.value)}
              />
            </label>
            <span className="dash-field-label">
              {fuelWord} · {tr("contracts.atPickup")}
            </span>
            <FuelGauge
              value={form.fuelPickup}
              disabled={pickupReadOnly}
              label={fuelWord}
              onChange={(v) => set("fuelPickup", v)}
            />
          </div>
          <div>
            <h3 className="dash-contract-sub">{tr("contracts.return")}</h3>
            <p className="dash-form-note">
              {s ? `${shortDate(s.booking.returnDate, locale)} ${s.booking.returnTime ?? ""}` : "—"}
            </p>
            <label className="dash-field">
              {tr("contracts.location")}
              <input
                value={form.returnLocation}
                disabled={pickupReadOnly}
                onChange={(e) => set("returnLocation", e.target.value)}
              />
            </label>
            <span className="dash-field-label">
              {fuelWord} · {tr("contracts.atReturn")}
            </span>
            <FuelGauge
              value={form.fuelReturn}
              disabled={readOnly}
              label={fuelWord}
              onChange={(v) => set("fuelReturn", v)}
            />
          </div>
        </div>
      </section>

      {/* ── Σκαρίφημα ζημιών ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">{tr("contracts.damages")}</h2>
        <p className="dash-form-note">
          {pickupReadOnly ? tr("contracts.damagesReadOnly") : tr("contracts.damagesHelp")}
        </p>
        <div className="dash-damage">
          <DamageSketch
            className="dash-damage-sketch"
            marks={form.damageMarks}
            onAdd={pickupReadOnly ? undefined : addMark}
            onSelect={setSelectedMark}
            selectedId={selectedMark}
          />
          <ol className="dash-damage-list">
            {form.damageMarks.length === 0 && (
              <li className="dash-form-note">{tr("contracts.noDamages")}</li>
            )}
            {form.damageMarks.map((m, i) => (
              <li key={m.id} className={m.id === selectedMark ? "active" : ""}>
                <span className="dash-damage-num">{i + 1}</span>
                <input
                  value={m.note}
                  placeholder={tr("contracts.damageNote")}
                  disabled={pickupReadOnly}
                  maxLength={200}
                  onFocus={() => setSelectedMark(m.id)}
                  onChange={(e) => setMarkNote(m.id, e.target.value)}
                />
                {!pickupReadOnly && (
                  <button
                    className="dash-icon-btn"
                    onClick={() => removeMark(m.id)}
                    aria-label={tr("contracts.removeMark")}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Οικονομικά ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">{tr("contracts.charges")}</h2>
        {s ? (
          <div className="dash-contract-money">
            <div className="dash-contract-line">
              <span>
                {tr("contracts.rental")} · {s.booking.totalDays} × {eur(s.booking.dailyRate, locale)}
              </span>
              <span>{eur(s.booking.subtotal, locale)}</span>
            </div>
            {s.extras.map((x, i) => (
              <div key={`x${i}`} className="dash-contract-line">
                <span>{x.name}</span>
                <span>{eur(x.lineTotal, locale)}</span>
              </div>
            ))}
            {s.insurance.map((x, i) => (
              <div key={`i${i}`} className="dash-contract-line">
                <span>
                  {x.name}
                  <small>
                    {" "}
                    · {tr("contracts.excess")}{" "}
                    {x.excess === null ? tr("contracts.excessNotSet") : eur(x.excess, locale)}
                  </small>
                </span>
                <span>{eur(x.lineTotal, locale)}</span>
              </div>
            ))}
            {s.booking.discountAmount > 0 && (
              <div className="dash-contract-line">
                <span>{tr("contracts.discount")}</span>
                <span>−{eur(s.booking.discountAmount, locale)}</span>
              </div>
            )}
            <div className="dash-contract-line dash-contract-total">
              <span>{tr("contracts.total")}</span>
              <span>{eur(s.booking.total, locale)}</span>
            </div>
            <p className="dash-form-note">{tr("contracts.snapshotNote")}</p>
          </div>
        ) : (
          <p className="dash-form-note">—</p>
        )}

        <div className="dash-form-grid">
          <label className="dash-field">
            {tr("contracts.paymentMethod")}
            <select
              value={form.paymentMethod}
              disabled={pickupReadOnly}
              onChange={(e) => set("paymentMethod", e.target.value)}
            >
              <option value="">—</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {tr(`contracts.payment_${m}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="dash-field">
            {tr("contracts.depositAmount")}
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.depositAmount}
              disabled={pickupReadOnly}
              onChange={(e) => set("depositAmount", e.target.value)}
            />
          </label>
          <label className="dash-field">
            {tr("contracts.depositMethod")}
            <select
              value={form.depositMethod}
              disabled={pickupReadOnly}
              onChange={(e) => set("depositMethod", e.target.value)}
            >
              <option value="">—</option>
              {DEPOSIT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {tr(`contracts.deposit_${m}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* ── Αλλαγή οχήματος (κλειστή) ── */}
      <section className="dash-panel dash-contract-section">
        <button className="dash-collapse" onClick={() => setOpenChanges((o) => !o)} aria-expanded={openChanges}>
          {openChanges ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          {tr("contracts.vehicleChanges")}
          {form.vehicleChanges.length > 0 && <span className="dash-count">({form.vehicleChanges.length})</span>}
        </button>
        {openChanges && (
          <div className="dash-collapse-body">
            {form.vehicleChanges.length === 0 && (
              <p className="dash-form-note">{tr("contracts.noVehicleChanges")}</p>
            )}
            {form.vehicleChanges.map((c) => (
              <div key={c.id} className="dash-change-row">
                <label className="dash-field">
                  {tr("contracts.newVehicle")}
                  <select
                    value={c.vehicleId}
                    disabled={readOnly}
                    onChange={(e) => setChange(c.id, "vehicleId", e.target.value)}
                  >
                    <option value="">—</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="dash-field">
                  {tr("contracts.changeDate")}
                  <input
                    type="date"
                    value={c.date}
                    disabled={readOnly}
                    onChange={(e) => setChange(c.id, "date", e.target.value)}
                  />
                </label>
                {!readOnly && (
                  <button
                    className="dash-icon-btn"
                    onClick={() => removeChange(c.id)}
                    aria-label={tr("contracts.removeChange")}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button className="dash-btn" onClick={addChange}>
                <Plus size={16} /> {tr("contracts.addVehicleChange")}
              </button>
            )}
          </div>
        )}
      </section>

      {/* ── Παρατηρήσεις (κλειστή) ── */}
      <section className="dash-panel dash-contract-section">
        <button className="dash-collapse" onClick={() => setOpenNotes((o) => !o)} aria-expanded={openNotes}>
          {openNotes ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          {tr("contracts.notes")}
        </button>
        {openNotes && (
          <div className="dash-collapse-body">
            <textarea
              className="dash-textarea"
              rows={4}
              value={form.notes}
              disabled={readOnly}
              maxLength={5000}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
        )}
      </section>

      {/* ── Όροι + GDPR ── */}
      <section className="dash-panel dash-contract-section">
        <button className="dash-collapse" onClick={() => setOpenTerms((o) => !o)} aria-expanded={openTerms}>
          {openTerms ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          {tr("contracts.terms")}
        </button>
        {openTerms && (
          <div className="dash-collapse-body dash-contract-terms">
            {s?.terms.el || s?.terms.en ? (
              <>
                {s.terms.el && <p>{s.terms.el}</p>}
                {s.terms.en && <p>{s.terms.en}</p>}
              </>
            ) : (
              <p className="dash-form-note">{tr("contracts.noTerms")}</p>
            )}
          </div>
        )}
        <label className="dash-field dash-field--check dash-contract-gdpr">
          <input
            type="checkbox"
            checked={form.gdprConsent}
            disabled={pickupReadOnly}
            onChange={(e) => set("gdprConsent", e.target.checked)}
          />
          <span className="dash-contract-gdpr-text">
            <span>{GDPR_TEXT.el}</span>
            <small>{GDPR_TEXT.en}</small>
          </span>
        </label>
      </section>

      {/* ── Υπογραφές ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">
          {tr("contracts.signatures")}{" "}
          <span className="dash-count">
            {signedCount}/{contract.drivers.length}
          </span>
        </h2>
        {!locked && !readOnly && !canSignNow && (
          <p className="dash-form-note">
            {dirty ? tr("contracts.saveBeforeSign") : tr("contracts.gdprBeforeSign")}
          </p>
        )}
        <div className="dash-sign-grid">
          {contract.drivers.map((d, i) => (
            <div key={d.id} className="dash-sign-card">
              <div className="dash-sign-preview">
                {d.signature ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.signature} alt="" />
                ) : (
                  <span className="dash-form-note">{tr("contracts.notSigned")}</span>
                )}
              </div>
              <strong>{d.fullName || `${tr("contracts.driver")} ${i + 1}`}</strong>
              {!locked && !readOnly && (
                <div className="dash-sign-card-actions">
                  {d.signature ? (
                    <button className="dash-btn" disabled={busy} onClick={() => sign(d.id, null)}>
                      <Eraser size={15} /> {tr("contracts.clearSignature")}
                    </button>
                  ) : (
                    <button
                      className="dash-btn dash-btn--primary"
                      disabled={busy || !canSignNow}
                      onClick={() => setSigning(d)}
                    >
                      <PenLine size={15} /> {tr("contracts.sign")}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {contract.status === "SIGNED" && can.edit && (
          <div className="dash-contract-complete">
            <button
              className="dash-btn dash-btn--primary"
              disabled={busy || dirty || contract.fuelReturn === null}
              onClick={complete}
            >
              <CheckCircle2 size={16} /> {tr("contracts.complete")}
            </button>
            {contract.fuelReturn === null && (
              <span className="dash-form-note">{tr("contracts.completeNeedsFuel")}</span>
            )}
          </div>
        )}
        {allSigned(contract.drivers) && contract.signedAt && (
          <p className="dash-form-note">
            {tr("contracts.signedAt")}{" "}
            {new Date(contract.signedAt).toLocaleString(INTL[locale] ?? "el-GR", {
              timeZone: "Europe/Athens",
            })}
          </p>
        )}
      </section>

      {error && <div className="dash-form-error">{error}</div>}
      {notice && <div className="dash-alert-ok">{notice}</div>}

      {/* ── Μπάρα αποθήκευσης ── */}
      {!readOnly && dirty && (
        <div className="dash-savebar">
          <span>{tr("contracts.unsaved")}</span>
          <button className="dash-btn" disabled={busy} onClick={() => setForm(fromContract(contract))}>
            {tr("contracts.discard")}
          </button>
          <button
            className="dash-btn dash-btn--primary"
            disabled={busy || changesIncomplete}
            onClick={() => save()}
          >
            <Save size={16} /> {busy ? tr("contracts.saving") : tr("contracts.save")}
          </button>
        </div>
      )}

      {/* ── Υπογραφή οδηγού ── */}
      {signing && (
        <div className="dash-modal-overlay" onClick={() => !busy && setSigning(null)}>
          <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dash-modal-header">
              <h2>
                {tr("contracts.signatureOf")} {signing.fullName}
              </h2>
              <button className="dash-icon-btn" onClick={() => setSigning(null)} aria-label={tr("contracts.cancel")}>
                <X size={18} />
              </button>
            </div>
            <div className="dash-modal-body">
              <SignaturePad
                busy={busy}
                onCancel={() => setSigning(null)}
                onSave={(dataUrl) => sign(signing.id, dataUrl)}
                labels={{
                  clear: tr("contracts.clearPad"),
                  save: tr("contracts.saveSignature"),
                  cancel: tr("contracts.cancel"),
                  hint: tr("contracts.signHint"),
                }}
              />
              {error && <div className="dash-form-error">{error}</div>}
            </div>
          </div>
        </div>
      )}

      {confirmReset && (
        <div className="dash-modal-overlay" onClick={() => setConfirmReset(false)}>
          <div className="dash-modal dash-modal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="dash-modal-header">
              <h2>{tr("contracts.resetTitle")}</h2>
            </div>
            <div className="dash-modal-body">
              <p className="dash-form-note">{tr("contracts.resetBody")}</p>
            </div>
            <div className="dash-modal-footer">
              <button className="dash-btn" onClick={() => setConfirmReset(false)}>
                {tr("contracts.cancel")}
              </button>
              <button className="dash-btn dash-btn--danger" onClick={() => save(true)}>
                {tr("contracts.resetConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="dash-modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="dash-modal dash-modal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="dash-modal-header">
              <h2>{tr("contracts.deleteTitle")}</h2>
            </div>
            <div className="dash-modal-body">
              <p className="dash-form-note">{tr("contracts.deleteBody")}</p>
            </div>
            <div className="dash-modal-footer">
              <button className="dash-btn" onClick={() => setConfirmDelete(false)}>
                {tr("contracts.cancel")}
              </button>
              <button className="dash-btn dash-btn--danger" disabled={busy} onClick={remove}>
                {tr("contracts.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
