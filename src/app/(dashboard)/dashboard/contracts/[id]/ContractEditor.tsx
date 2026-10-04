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
  photoLockOf,
  type ContractPhotoDTO,
  type PhotoGroup,
  CARD_BRANDS,
  CARD_EXPIRY_RE,
  LAST4_RE,
  depositUsesCard,
  paymentUsesCard,
  type CardInfo,
} from "@/lib/contracts";
import { computePrice, toDisplayBreakdown, type PricedExtraInput } from "@/lib/pricing";
import { splitVatInclusive } from "@/lib/invoices";
import type { ExtraDTO } from "@/lib/extras";
import DamageSketch from "@/components/contracts/DamageSketch";
import FuelGauge from "@/components/contracts/FuelGauge";
import SignaturePad from "@/components/contracts/SignaturePad";
import PhotoManager from "@/components/photos/PhotoManager";
import { MAX_CONTRACT_PHOTOS, type PhotoItem } from "@/lib/photoShared";

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
  damageNotesPickup: string;
  damageNotesReturn: string;
  vehicleChanges: ChangeRow[];
  notes: string;
  paymentMethod: string;
  depositAmount: string;
  depositMethod: string;
  paymentCard: CardForm;
  depositCard: CardForm;
  gdprConsent: boolean;
  extraIds: string[];
}

/** Κάρτα στη φόρμα — ΜΟΝΟ τα 4 επιτρεπτά πεδία, ποτέ πλήρης αριθμός/CVV. */
interface CardForm {
  brand: string;
  last4: string;
  holder: string;
  expiry: string;
}

const emptyCard = (): CardForm => ({ brand: "VISA", last4: "", holder: "", expiry: "" });
const cardFromDTO = (c: CardInfo | null): CardForm => (c ? { ...c } : emptyCard());

/** Κενή κάρτα → null. Μερικώς συμπληρωμένη → στέλνεται και την ελέγχει ο server. */
const cardPayload = (c: CardForm): CardInfo | null =>
  c.last4.trim() || c.holder.trim() || c.expiry.trim()
    ? {
        brand: c.brand as CardInfo["brand"],
        last4: c.last4.trim(),
        holder: c.holder.trim(),
        expiry: c.expiry.trim(),
      }
    : null;

/** Η κάρτα είναι έγκυρη για αποθήκευση (κενή = εντάξει). */
const cardValid = (c: CardForm) =>
  cardPayload(c) === null || (LAST4_RE.test(c.last4) && CARD_EXPIRY_RE.test(c.expiry));

const fromContract = (c: ContractDTO): FormState => ({
  drivers: c.drivers,
  pickupLocation: c.pickupLocation,
  returnLocation: c.returnLocation,
  fuelPickup: c.fuelPickup,
  damageNotesPickup: c.damageNotesPickup,
  damageNotesReturn: c.damageNotesReturn,
  vehicleChanges: c.vehicleChanges.map((v) => ({ id: v.id, vehicleId: v.vehicleId, date: v.date })),
  notes: c.notes,
  paymentMethod: c.paymentMethod ?? "",
  depositAmount: c.depositAmount === null ? "" : String(c.depositAmount),
  depositMethod: c.depositMethod ?? "",
  paymentCard: cardFromDTO(c.paymentCard),
  depositCard: cardFromDTO(c.depositCard),
  gdprConsent: c.gdprConsent,
  extraIds: [...c.bookingExtraIds].sort(),
});

/** Τα στοιχεία παραλαβής — ό,τι κλειδώνει με την υπογραφή όλων. */
const pickupPart = (f: FormState) =>
  JSON.stringify({
    drivers: f.drivers.map(({ signature: _s, signedAt: _a, ...rest }) => rest),
    pickupLocation: f.pickupLocation,
    returnLocation: f.returnLocation,
    fuelPickup: f.fuelPickup,
    damageNotesPickup: f.damageNotesPickup,
    paymentMethod: f.paymentMethod,
    depositAmount: f.depositAmount,
    depositMethod: f.depositMethod,
    paymentCard: paymentUsesCard(f.paymentMethod) ? cardPayload(f.paymentCard) : null,
    depositCard: depositUsesCard(f.depositMethod) ? cardPayload(f.depositCard) : null,
    gdprConsent: f.gdprConsent,
  });

const extrasPart = (f: FormState) => f.extraIds.join(",");

const afterPart = (f: FormState) =>
  JSON.stringify({
    damageNotesReturn: f.damageNotesReturn,
    vehicleChanges: f.vehicleChanges,
    notes: f.notes,
  });

/** Το σώμα του PATCH. Σε υπογεγραμμένο στέλνουμε μόνο ό,τι επιτρέπεται. */
function toPayload(f: FormState, locked: boolean, sendExtras: boolean) {
  const after = {
    damageNotesReturn: f.damageNotesReturn,
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
    damageNotesPickup: f.damageNotesPickup,
    paymentMethod: f.paymentMethod || null,
    depositAmount: f.depositAmount.trim() === "" ? null : Number(f.depositAmount),
    depositMethod: f.depositMethod || null,
    paymentCard: paymentUsesCard(f.paymentMethod) ? cardPayload(f.paymentCard) : null,
    depositCard: depositUsesCard(f.depositMethod) ? cardPayload(f.depositCard) : null,
    gdprConsent: f.gdprConsent,
    ...(sendExtras && { extraIds: f.extraIds }),
  };
}

/* ─────────────────────────────────────────────
   Σελίδα
   ───────────────────────────────────────────── */

export default function ContractEditor({
  initialContract,
  vehicles,
  extras,
  vatRate,
  roundUpTotal,
  can,
}: {
  initialContract: ContractDTO;
  vehicles: VehicleOption[];
  /** Τα πρόσθετα της εταιρίας (και ανενεργά, για όσα έχει ήδη η κράτηση). */
  extras: ExtraDTO[];
  vatRate: number;
  roundUpTotal: boolean;
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
  // Οι φωτογραφίες ζουν χωριστά από τη φόρμα: ανεβαίνουν αμέσως και δεν
  // περιμένουν το «Αποθήκευση» (ούτε το χαλάνε αν αποτύχουν).
  const [photos, setPhotos] = useState<ContractPhotoDTO[]>(initialContract.damagePhotos);
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
  const extrasDirty = extrasPart(form) !== extrasPart(saved);
  const dirty = pickupDirty || extrasDirty || afterPart(form) !== afterPart(saved);
  const hasSignatures = anySigned(contract.drivers);
  const extrasEditable = !readOnly && !locked && contract.extrasLock === null;

  /* ── Χρεώσεις: αποθηκευμένες ή ζωντανή προεπισκόπηση ── */
  const money = useMemo(() => {
    if (!s) return null;
    const extraById = new Map(extras.map((e) => [e.id, e]));
    if (!extrasDirty) {
      return {
        preview: false,
        extras: s.extras,
        insurance: s.insurance,
        display: toDisplayBreakdown(s.booking),
      };
    }
    // Ο ΙΔΙΟΣ υπολογισμός με την κράτηση. Ο server ξαναϋπολογίζει στην
    // αποθήκευση — εδώ είναι μόνο προεπισκόπηση.
    const chosen: PricedExtraInput[] = form.extraIds.flatMap((id) => {
      const e = extraById.get(id);
      return e ? [{ id, name: e.name, price: e.price, chargeType: e.chargeType, type: e.type }] : [];
    });
    const b = computePrice({
      totalDays: s.booking.totalDays,
      dailyRate: s.booking.dailyRate,
      extras: chosen,
      discountMode: s.booking.discountCode ? "CODE" : s.booking.discountAmount > 0 ? "AMOUNT" : "NONE",
      discountValue: s.booking.discountAmount,
      codeDiscountAmount: s.booking.discountAmount,
      roundUpTotal,
    });
    return {
      preview: true,
      extras: b.lines.filter((l) => l.type !== "INSURANCE").map((l) => ({ name: l.name, lineTotal: l.lineTotal })),
      insurance: b.lines
        .filter((l) => l.type === "INSURANCE")
        .map((l) => ({ name: l.name, lineTotal: l.lineTotal, excess: extraById.get(l.id)?.excess ?? null })),
      display: toDisplayBreakdown(b),
    };
  }, [s, extras, extrasDirty, form.extraIds, roundUpTotal]);

  const vat = money ? splitVatInclusive(money.display.total, s?.vatRate ?? vatRate) : null;
  const totalChangedAfterSign =
    hasSignatures && s !== null && Math.abs(s.booking.total - contract.bookingTotalNow) > 0.004;
  const cardsInvalid =
    (paymentUsesCard(form.paymentMethod) && !cardValid(form.paymentCard)) ||
    (depositUsesCard(form.depositMethod) && !cardValid(form.depositCard));

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
        body: JSON.stringify(toPayload(form, locked, extrasDirty && extrasEditable)),
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

  /* ── Φωτογραφίες ζημιών ── */
  const photoProps = (group: PhotoGroup) => {
    const lock = photoLockOf(group, contract.status, contract.drivers);
    return {
      photos: photos.filter((p) => p.group === group),
      uploadUrl: `/api/contracts/${contract.id}/photos`,
      fields: { group },
      itemUrl: (id: string) => `/api/contracts/${contract.id}/photos/${id}`,
      editable: can.edit && lock === null,
      withNotes: true,
      // Το όριο είναι ανά συμβόλαιο: όσες χωράνε ακόμα συνολικά.
      max: MAX_CONTRACT_PHOTOS - photos.length + photos.filter((p) => p.group === group).length,
      lockedText: lock ? tr(`contracts.photosLock_${lock}`) : undefined,
      counter: `${photos.length}/${MAX_CONTRACT_PHOTOS}`,
      onAdded: (p: PhotoItem) =>
        setPhotos((list) => [...list, { ...p, group }]),
      onRemoved: (id: string) => setPhotos((list) => list.filter((p) => p.id !== id)),
      onNoted: (id: string, note: string) =>
        setPhotos((list) => list.map((p) => (p.id === id ? { ...p, note } : p))),
    };
  };

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
            {/* Παλιά συμβόλαια: το καύσιμο παράδοσης μόνο για ανάγνωση. */}
            {contract.fuelReturn !== null && (
              <>
                <span className="dash-field-label">
                  {fuelWord} · {tr("contracts.atReturn")} · {tr("contracts.legacy")}
                </span>
                <FuelGauge value={contract.fuelReturn} disabled label={fuelWord} onChange={() => {}} />
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Ζημιές: φωτογραφίες παραλαβής / παράδοσης ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">{tr("contracts.damagesTitle")}</h2>
        <p className="dash-form-note">{tr("contracts.photosHelp")}</p>

        <div className="dash-damage-group">
          <h3 className="dash-contract-sub">{tr("contracts.damagesPickup")}</h3>
          <PhotoManager {...photoProps("PICKUP")} />
          <label className="dash-field">
            {tr("contracts.damageDescription")}
            <textarea
              className="dash-textarea"
              rows={2}
              maxLength={1000}
              value={form.damageNotesPickup}
              disabled={pickupReadOnly}
              placeholder={pickupReadOnly ? "" : tr("contracts.damageNote")}
              onChange={(e) => set("damageNotesPickup", e.target.value)}
            />
          </label>
        </div>

        <div className="dash-damage-group">
          <h3 className="dash-contract-sub">{tr("contracts.damagesReturn")}</h3>
          <PhotoManager {...photoProps("RETURN")} />
          <label className="dash-field">
            {tr("contracts.damageDescription")}
            <textarea
              className="dash-textarea"
              rows={2}
              maxLength={1000}
              value={form.damageNotesReturn}
              disabled={readOnly}
              placeholder={readOnly ? "" : tr("contracts.damageNote")}
              onChange={(e) => set("damageNotesReturn", e.target.value)}
            />
          </label>
        </div>

        {/* Παλιά συμβόλαια με σκαρίφημα: μόνο ανάγνωση, μικρό. */}
        {contract.damageMarks.length > 0 && (
          <div className="dash-damage-legacy">
            <h3 className="dash-contract-sub">{tr("contracts.oldSketch")}</h3>
            <div className="dash-damage">
              <DamageSketch className="dash-damage-sketch dash-damage-sketch--small" marks={contract.damageMarks} />
              <ol className="dash-damage-list">
                {contract.damageMarks.map((m, i) => (
                  <li key={m.id}>
                    <span className="dash-damage-num">{i + 1}</span>
                    <span>{m.note || "—"}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </section>

      {/* ── Οικονομικά ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">{tr("contracts.charges")}</h2>
        {totalChangedAfterSign && (
          <div className="dash-contract-warn">
            <AlertTriangle size={15} /> {tr("contracts.totalChangedAfterSign")} (
            {eur(contract.bookingTotalNow, locale)})
          </div>
        )}
        {s && money ? (
          <div className="dash-contract-money">
            <div className="dash-contract-line">
              <span>
                {tr("contracts.rental")} · {s.booking.totalDays} × {eur(s.booking.dailyRate, locale)}
              </span>
              <span>{eur(money.display.subtotal, locale)}</span>
            </div>
            {money.extras.map((x, i) => (
              <div key={`x${i}`} className="dash-contract-line">
                <span>{x.name}</span>
                <span>{eur(x.lineTotal, locale)}</span>
              </div>
            ))}
            {money.insurance.map((x, i) => (
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
            {money.display.discountAmount > 0 && (
              <div className="dash-contract-line">
                <span>{tr("contracts.discount")}</span>
                <span>−{eur(money.display.discountAmount, locale)}</span>
              </div>
            )}
            <div className="dash-contract-line dash-contract-total">
              <span>{tr("contracts.total")}</span>
              <span>{eur(money.display.total, locale)}</span>
            </div>
            {vat && (
              <p className="dash-contract-vat">
                {tr("contracts.ofWhich")}: {tr("contracts.net")} {eur(vat.net, locale)} +{" "}
                {tr("contracts.vat")} {vat.vatRate}% {eur(vat.vatAmount, locale)}
              </p>
            )}
            <p className="dash-form-note">
              {money.preview ? tr("contracts.previewNote") : tr("contracts.snapshotNote")}
            </p>
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

        {paymentUsesCard(form.paymentMethod) && (
          <CardFields
            title={tr("contracts.paymentCard")}
            value={form.paymentCard}
            disabled={pickupReadOnly}
            onChange={(v) => set("paymentCard", v)}
          />
        )}
        {depositUsesCard(form.depositMethod) && (
          <CardFields
            title={tr("contracts.depositCard")}
            value={form.depositCard}
            disabled={pickupReadOnly}
            onChange={(v) => set("depositCard", v)}
          />
        )}
      </section>

      {/* ── Πρόσθετα / Extras ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">{tr("contracts.extras")}</h2>
        {!extrasEditable && contract.extrasLock && (
          <p className="dash-form-note">
            <Lock size={13} /> {tr(`contracts.extrasLock_${contract.extrasLock}`)}
          </p>
        )}
        {extras.length === 0 ? (
          <p className="dash-form-note">{tr("contracts.noExtras")}</p>
        ) : (
          <div className="dash-extras-pick">
            {extras
              // Ανενεργά μόνο όσα έχει ήδη η κράτηση.
              .filter((e) => e.isActive || form.extraIds.includes(e.id))
              .map((e) => {
                const checked = form.extraIds.includes(e.id);
                return (
                  <label key={e.id} className={`dash-extra-pick ${checked ? "on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!extrasEditable}
                      onChange={(ev) =>
                        set(
                          "extraIds",
                          (ev.target.checked
                            ? [...form.extraIds, e.id]
                            : form.extraIds.filter((x) => x !== e.id)
                          ).sort()
                        )
                      }
                    />
                    <span className="dash-extra-pick-name">
                      {e.name}
                      {e.type === "INSURANCE" && (
                        <small> · {tr("contracts.insuranceTag")}</small>
                      )}
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
        {extrasEditable && <p className="dash-form-note">{tr("contracts.extrasHelp")}</p>}
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
              disabled={busy || dirty}
              onClick={complete}
            >
              <CheckCircle2 size={16} /> {tr("contracts.complete")}
            </button>
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
            disabled={busy || changesIncomplete || cardsInvalid}
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

/* ─────────────────────────────────────────────
   Κάρτα: ΜΟΝΟ τύπος, 4 τελευταία ψηφία, κάτοχος, λήξη
   ───────────────────────────────────────────── */

function CardFields({
  title,
  value,
  disabled,
  onChange,
}: {
  title: string;
  value: CardForm;
  disabled: boolean;
  onChange: (v: CardForm) => void;
}) {
  const tr = useT();
  const set = (k: keyof CardForm, v: string) => onChange({ ...value, [k]: v });
  const last4Bad = value.last4 !== "" && !LAST4_RE.test(value.last4);
  const expiryBad = value.expiry !== "" && !CARD_EXPIRY_RE.test(value.expiry);

  return (
    <div className="dash-card-box">
      <h3 className="dash-contract-sub">{title}</h3>
      <div className="dash-form-grid">
        <label className="dash-field">
          {tr("contracts.cardBrand")}
          <select value={value.brand} disabled={disabled} onChange={(e) => set("brand", e.target.value)}>
            {CARD_BRANDS.map((b) => (
              <option key={b} value={b}>
                {tr(`contracts.cardBrand_${b}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="dash-field">
          {tr("contracts.cardLast4")}
          <input
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="1234"
            value={value.last4}
            disabled={disabled}
            // Μόνο ψηφία, το πολύ 4: ο πλήρης αριθμός δεν χωρά ποτέ εδώ.
            onChange={(e) => set("last4", e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
          {last4Bad && <span className="dash-field-error">{tr("contracts.cardLast4Error")}</span>}
        </label>
        <label className="dash-field">
          {tr("contracts.cardHolder")}
          <input
            autoComplete="off"
            maxLength={100}
            value={value.holder}
            disabled={disabled}
            onChange={(e) => set("holder", e.target.value)}
          />
        </label>
        <label className="dash-field">
          {tr("contracts.cardExpiry")}
          <input
            inputMode="numeric"
            autoComplete="off"
            maxLength={5}
            placeholder="MM/YY"
            value={value.expiry}
            disabled={disabled}
            onChange={(e) => {
              const d = e.target.value.replace(/\D/g, "").slice(0, 4);
              set("expiry", d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
            }}
          />
          {expiryBad && <span className="dash-field-error">{tr("contracts.cardExpiryError")}</span>}
        </label>
      </div>
      <p className="dash-form-note">{tr("contracts.cardPciNote")}</p>
    </div>
  );
}
