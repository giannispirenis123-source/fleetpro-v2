"use client";

// Το ηλεκτρονικό συμβόλαιο — ΚΑΙ για νέο συμβόλαιο (walk-in).
//
// · initialContract = null → «νέο»: όχημα, ημερομηνίες και ζωντανή τιμή
//   στην κορυφή, κύριος οδηγός με αναγνώριση παλιού πελάτη. Τίποτα δεν
//   γράφεται πριν την πρώτη «Αποθήκευση»· τότε ο server φτιάχνει σε ΜΙΑ
//   transaction πελάτη + κράτηση + συμβόλαιο, και η ίδια φόρμα συνεχίζει
//   (υπογραφές/φωτογραφίες ενεργοποιούνται) χωρίς να αλλάξει σελίδα.
// · Ελάχιστα υποχρεωτικά: κύριος οδηγός (όνομα, τηλέφωνο), όχημα,
//   ημερομηνίες, GDPR, υπογραφή. Όλα τα άλλα σε κλειστές ενότητες.

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  Link2,
  Share2,
  Copy,
  RefreshCw,
  Ban,
  FileSignature,
  UserCheck,
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
  MAX_LICENSE_PHOTOS,
  licenseLockOf,
  type LicensePhotoDTO,
} from "@/lib/contracts";
import { appBaseUrl, publicContractUrl, type PublicLinkDTO } from "@/lib/contractLink";
import { computePrice, toDisplayBreakdown, type PricedExtraInput } from "@/lib/pricing";
import { splitVatInclusive } from "@/lib/invoices";
import { phoneDigits, type CustomerSearchField } from "@/lib/customerMatch";
import type { ExtraDTO } from "@/lib/extras";
import type { WalkInCustomer } from "@/lib/walkIn";
import DamageSketch from "@/components/contracts/DamageSketch";
import FuelGauge from "@/components/contracts/FuelGauge";
import SignaturePad from "@/components/contracts/SignaturePad";
import PhotoManager from "@/components/photos/PhotoManager";
import { MAX_CONTRACT_PHOTOS, type PhotoItem } from "@/lib/photoShared";
import NewContractModal from "../NewContractModal";
import { WalkInSection, eur, useWalkInDraft, windowValid } from "./WalkInSection";
import { SuggestList, useCustomerSuggest } from "./CustomerSuggest";

const INTL: Record<string, string> = { el: "el-GR", en: "en-GB" };

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

/** Νέο συμβόλαιο: προεπιλογές — μετρητά, εγγύηση χωρίς ποσό, ένας οδηγός. */
const newForm = (): FormState => ({
  drivers: [emptyDriver(randomId())],
  pickupLocation: "",
  returnLocation: "",
  fuelPickup: null,
  damageNotesPickup: "",
  damageNotesReturn: "",
  vehicleChanges: [],
  notes: "",
  paymentMethod: "CASH",
  depositAmount: "",
  depositMethod: "",
  paymentCard: emptyCard(),
  depositCard: emptyCard(),
  gdprConsent: false,
  extraIds: [],
});

const driverPayload = (drivers: ContractDriver[]) =>
  drivers.map(({ signature: _s, signedAt: _a, licensePhotos: _l, ...rest }) => rest);

/** Τα στοιχεία παραλαβής — ό,τι κλειδώνει με την υπογραφή όλων. */
const pickupPart = (f: FormState) =>
  JSON.stringify({
    drivers: driverPayload(f.drivers),
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

/** Τα στοιχεία παραλαβής για PATCH και για τη δημιουργία. */
const pickupPayload = (f: FormState) => ({
  drivers: driverPayload(f.drivers),
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
    ...pickupPayload(f),
    ...(sendExtras && { extraIds: f.extraIds }),
  };
}

/** Το σώμα της δημιουργίας (walk-in): χωρίς πρόσθετα (πάνε στην κράτηση). */
function toCreatePayload(f: FormState) {
  const p = pickupPayload(f);
  return {
    ...p,
    // Εγγύηση χωρίς ποσό: δεν στέλνεται, ισχύει ό,τι έχει η κράτηση.
    depositAmount: p.depositAmount ?? undefined,
    damageNotesReturn: f.damageNotesReturn,
    notes: f.notes,
  };
}

/** Πεδία του κύριου οδηγού με αναγνώριση πελάτη. */
const SUGGEST_FIELD: Partial<Record<keyof ContractDriver, CustomerSearchField>> = {
  fullName: "name",
  phone: "phone",
  email: "email",
  idNumber: "idNumber",
  licenseNumber: "licenseNumber",
  address: "address",
};

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
  logoUrl,
  walkIn,
}: {
  /** null = νέο συμβόλαιο (walk-in), πριν την πρώτη αποθήκευση. */
  initialContract: ContractDTO | null;
  vehicles: VehicleOption[];
  /** Τα πρόσθετα της εταιρίας (και ανενεργά, για όσα έχει ήδη η κράτηση). */
  extras: ExtraDTO[];
  vatRate: number;
  roundUpTotal: boolean;
  can: { edit: boolean; delete: boolean };
  /** Τρέχον λογότυπο εταιρίας (signed URL) ή null. */
  logoUrl: string | null;
  /** Μόνο στο νέο συμβόλαιο. Κενό `partners` για συνεργάτη. */
  walkIn?: { partners: { id: string; name: string }[]; canOverride: boolean };
}) {
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();

  const [contract, setContract] = useState<ContractDTO | null>(initialContract);
  const [form, setForm] = useState<FormState>(() =>
    initialContract ? fromContract(initialContract) : newForm()
  );
  const isNew = contract === null;
  const saved = useMemo(() => (contract ? fromContract(contract) : null), [contract]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [signing, setSigning] = useState<ContractDriver | null>(null);
  // Οι φωτογραφίες ζουν χωριστά από τη φόρμα: ανεβαίνουν αμέσως και δεν
  // περιμένουν το «Αποθήκευση» (ούτε το χαλάνε αν αποτύχουν).
  const [photos, setPhotos] = useState<ContractPhotoDTO[]>(initialContract?.damagePhotos ?? []);
  // Διπλώματα: όπως οι ζημιές, ανεβαίνουν αμέσως, χωριστά από τη φόρμα.
  const [licenses, setLicenses] = useState<LicensePhotoDTO[]>(initialContract?.licensePhotos ?? []);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg] = useState("");
  // Κλειστές ενότητες: όλες κλειστές από προεπιλογή.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  // Επιστροφή στον ίδιο χώρο: προεπιλογή στο νέο· στο παλιό μόνο αν ήδη ίδιοι.
  const [returnSame, setReturnSame] = useState(
    () => !initialContract || initialContract.returnLocation === initialContract.pickupLocation
  );
  const [fromBooking, setFromBooking] = useState(false);

  /* ── Νέο συμβόλαιο: πελάτης, όχημα, ημερομηνίες ── */
  const [linked, setLinked] = useState<{ id: string; name: string } | null>(null);
  const [duplicates, setDuplicates] = useState<WalkInCustomer[] | null>(null);
  const draft = useWalkInDraft(isNew, form.extraIds, linked?.id ?? null);
  const suggest = useCustomerSuggest(isNew && !linked);
  const canOverride = walkIn?.canOverride ?? false;

  const s = contract?.snapshot ?? null;
  const status = contract?.status ?? "DRAFT";
  const completed = status === "COMPLETED";
  const locked = status !== "DRAFT";
  const readOnly = !can.edit || completed;
  // Στο νέο συμβόλαιο ο χρήστης έχει ήδη contracts.create + bookings.create.
  const pickupReadOnly = isNew ? false : readOnly || locked;
  const electric = s?.vehicle.fuel === "ELECTRIC";
  const fuelWord = electric ? tr("contracts.battery") : tr("contracts.fuel");

  const pickupDirty = saved ? pickupPart(form) !== pickupPart(saved) : true;
  const extrasDirty = saved ? extrasPart(form) !== extrasPart(saved) : false;
  const dirty = saved
    ? pickupDirty || extrasDirty || afterPart(form) !== afterPart(saved)
    : true;
  const savedDrivers = contract?.drivers ?? [];
  const hasSignatures = anySigned(savedDrivers);
  const extrasEditable = isNew || (!readOnly && !locked && contract?.extrasLock === null);

  /* ── Χρεώσεις: αποθηκευμένες, ζωντανή προεπισκόπηση ή (νέο) από τον server ── */
  const money = useMemo(() => {
    if (isNew) {
      const p = draft.preview;
      if (!p) return null;
      return {
        preview: true,
        totalDays: p.totalDays,
        dailyRate: p.dailyRate,
        extras: p.lines.filter((l) => l.type !== "INSURANCE").map((l) => ({ name: l.name, lineTotal: l.lineTotal })),
        insurance: p.lines
          .filter((l) => l.type === "INSURANCE")
          .map((l) => ({ name: l.name, lineTotal: l.lineTotal, excess: null as number | null })),
        display: p.display,
        vatRate: p.vat.vatRate,
      };
    }
    if (!s) return null;
    const extraById = new Map(extras.map((e) => [e.id, e]));
    if (!extrasDirty) {
      return {
        preview: false,
        totalDays: s.booking.totalDays,
        dailyRate: s.booking.dailyRate,
        extras: s.extras,
        insurance: s.insurance,
        display: toDisplayBreakdown(s.booking),
        vatRate: s.vatRate ?? vatRate,
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
      totalDays: s.booking.totalDays,
      dailyRate: s.booking.dailyRate,
      extras: b.lines.filter((l) => l.type !== "INSURANCE").map((l) => ({ name: l.name, lineTotal: l.lineTotal })),
      insurance: b.lines
        .filter((l) => l.type === "INSURANCE")
        .map((l) => ({ name: l.name, lineTotal: l.lineTotal, excess: extraById.get(l.id)?.excess ?? null })),
      display: toDisplayBreakdown(b),
      vatRate: s.vatRate ?? vatRate,
    };
  }, [isNew, draft.preview, s, extras, extrasDirty, form.extraIds, roundUpTotal, vatRate]);

  const vat = money ? splitVatInclusive(money.display.total, money.vatRate) : null;
  const totalChangedAfterSign =
    !!contract && hasSignatures && s !== null && Math.abs(s.booking.total - contract.bookingTotalNow) > 0.004;
  const cardsInvalid =
    (paymentUsesCard(form.paymentMethod) && !cardValid(form.paymentCard)) ||
    (depositUsesCard(form.depositMethod) && !cardValid(form.depositCard));

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setNotice("");
  };

  const setDriver = (id: string, key: keyof ContractDriver, value: string) => {
    setForm((f) => ({
      ...f,
      drivers: f.drivers.map((d) => (d.id === id ? { ...d, [key]: value } : d)),
    }));
    setNotice("");
  };

  const setPickupLocation = (v: string) =>
    setForm((f) => ({ ...f, pickupLocation: v, ...(returnSame && { returnLocation: v }) }));

  /* ── Αναγνώριση παλιού πελάτη (κύριος οδηγός, μόνο στο νέο) ── */
  const mainId = form.drivers[0]?.id;
  const typeMain = (key: keyof ContractDriver, value: string) => {
    setDriver(mainId, key, value);
    const field = SUGGEST_FIELD[key];
    if (field && isNew && !linked) suggest.typed(field, value);
    if (key === "phone" || key === "email") setDuplicates(null);
  };

  const pickCustomer = async (c: WalkInCustomer) => {
    suggest.close();
    setError("");
    try {
      const res = await fetch(`/api/contracts/walk-in/customers?id=${encodeURIComponent(c.id)}`, {
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.message || tr("contracts.errorLoad"));
        return;
      }
      const filled: Partial<ContractDriver> = body.data.driver;
      // ΟΛΑ τα διαθέσιμα στοιχεία του πελάτη· τα κενά του δεν σβήνουν ό,τι γράφτηκε.
      setForm((f) => ({
        ...f,
        drivers: f.drivers.map((d, i) =>
          i === 0
            ? {
                ...d,
                ...Object.fromEntries(
                  Object.entries(filled).filter(([, v]) => typeof v === "string" && v !== "")
                ),
              }
            : d
        ),
      }));
      setLinked({ id: c.id, name: c.name });
      setDuplicates(null);
      setNotice(tr("contracts.customerFilled"));
    } catch {
      setError(tr("contracts.errorConnection"));
    }
  };

  /* ── Πρώτη αποθήκευση: πελάτης + κράτηση + συμβόλαιο ── */
  const nameOk = (form.drivers[0]?.fullName ?? "").trim().length > 0;
  const phoneOk = phoneDigits(form.drivers[0]?.phone ?? "").length >= 5;
  const missing = isNew
    ? [
        !nameOk && tr("contracts.missing_name"),
        !phoneOk && tr("contracts.missing_phone"),
        !windowValid(draft.win) && tr("contracts.missing_dates"),
        !draft.vehicleId && tr("contracts.missing_vehicle"),
      ].filter((x): x is string => !!x)
    : [];
  const canCreate =
    isNew && missing.length === 0 && draft.ready && !cardsInvalid && (!draft.hasConflict || canOverride);

  const create = async (opts: { override?: boolean; allowDuplicate?: boolean } = {}) => {
    if (busy || !isNew) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/contracts/walk-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(linked ? { customerId: linked.id } : {}),
          allowDuplicate: opts.allowDuplicate ?? false,
          override: opts.override ?? false,
          ...draft.bookingBody((walkIn?.partners.length ?? 0) > 0),
          contract: toCreatePayload({
            ...form,
            returnLocation: returnSame ? form.pickupLocation : form.returnLocation,
          }),
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
        if (res.status === 409) draft.reloadAvailability();
        return;
      }
      const next: ContractDTO = body.data.contract;
      setContract(next);
      setForm(fromContract(next));
      setPhotos(next.damagePhotos);
      setLicenses(next.licensePhotos);
      setDuplicates(null);
      // Η ίδια φόρμα μένει ανοιχτή· μόνο η διεύθυνση γίνεται του συμβολαίου.
      window.history.replaceState(null, "", `/dashboard/contracts/${next.id}`);
      setNotice(tr("contracts.createdNotice"));
    } catch {
      setError(tr("contracts.errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  /* ── Αποθήκευση ── */
  const save = async (force = false) => {
    if (!contract) return create();
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
        body: JSON.stringify(
          toPayload(
            { ...form, returnLocation: returnSame ? form.pickupLocation : form.returnLocation },
            locked,
            extrasDirty && extrasEditable
          )
        ),
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
    if (!contract) return;
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
    if (!contract) return;
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
    if (!contract) return;
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
  const addDriver = () => {
    setForm((f) => ({ ...f, drivers: [...f.drivers, emptyDriver(randomId())] }));
    setOpen((o) => ({ ...o, drivers: true }));
  };
  const removeDriver = (id: string) =>
    setForm((f) => ({ ...f, drivers: f.drivers.filter((d) => d.id !== id) }));

  /* ── Φωτογραφίες ζημιών ── */
  const photoProps = (c: ContractDTO, group: PhotoGroup) => {
    const lock = photoLockOf(group, c.status, c.drivers);
    return {
      photos: photos.filter((p) => p.group === group),
      uploadUrl: `/api/contracts/${c.id}/photos`,
      fields: { group },
      itemUrl: (id: string) => `/api/contracts/${c.id}/photos/${id}`,
      editable: can.edit && lock === null,
      withNotes: true,
      // Το όριο είναι ανά συμβόλαιο: όσες χωράνε ακόμα συνολικά.
      max: MAX_CONTRACT_PHOTOS - photos.length + photos.filter((p) => p.group === group).length,
      lockedText: lock ? tr(`contracts.photosLock_${lock}`) : undefined,
      counter: `${photos.length}/${MAX_CONTRACT_PHOTOS}`,
      onAdded: (p: PhotoItem) => setPhotos((list) => [...list, { ...p, group }]),
      onRemoved: (id: string) => setPhotos((list) => list.filter((p) => p.id !== id)),
      onNoted: (id: string, note: string) =>
        setPhotos((list) => list.map((p) => (p.id === id ? { ...p, note } : p))),
    };
  };

  /* ── Φωτογραφίες διπλώματος (ΜΟΝΟ εσωτερικά) ── */
  const savedDriverIds = new Set(savedDrivers.map((d) => d.id));
  const licenseProps = (c: ContractDTO, driverId: string) => {
    const uploadLock = licenseLockOf("upload", c.status, c.drivers);
    const deleteLock = licenseLockOf("delete", c.status, c.drivers);
    const lock = uploadLock ?? deleteLock;
    const mine = licenses.filter((l) => l.driverId === driverId);
    return {
      photos: mine.map((l) => ({ id: l.id, url: l.url, takenAt: null, note: "" })),
      uploadUrl: `/api/contracts/${c.id}/licenses`,
      fields: { driverId },
      itemUrl: (id: string) =>
        `/api/contracts/${c.id}/licenses?driverId=${encodeURIComponent(driverId)}&photoId=${encodeURIComponent(id)}`,
      editable: can.edit && uploadLock === null,
      canDelete: can.edit && deleteLock === null,
      withNotes: false,
      max: MAX_LICENSE_PHOTOS,
      lockedText: can.edit && lock ? tr(`contracts.licenseLock_${lock}`) : undefined,
      onAdded: (p: PhotoItem) =>
        setLicenses((list) => [...list, { driverId, id: p.id, url: p.url }]),
      onRemoved: (id: string) =>
        setLicenses((list) => list.filter((l) => !(l.driverId === driverId && l.id === id))),
      onNoted: () => undefined,
    };
  };

  const licenseBlock = (driverId: string) => (
    <div className="dash-license">
      <h3 className="dash-license-title">{tr("contracts.license")}</h3>
      {contract && savedDriverIds.has(driverId) ? (
        <PhotoManager {...licenseProps(contract, driverId)} />
      ) : (
        <p className="dash-form-note">{tr("contracts.saveFirstPhotos")}</p>
      )}
      <p className="dash-form-note">{tr("contracts.licensePrivateNote")}</p>
    </div>
  );

  /* ── Link πελάτη ── */
  const link: PublicLinkDTO | null = contract?.publicLink ?? null;
  // Το origin μόνο μετά το mount (αλλιώς διαφορά server/client στο hydration).
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const linkUrl =
    link && link.state === "active" && link.token && origin
      ? publicContractUrl(appBaseUrl(process.env.NEXT_PUBLIC_APP_URL, origin), link.token)
      : null;

  const copyLink = async () => {
    if (!linkUrl) return;
    setLinkMsg("");
    try {
      await navigator.clipboard.writeText(linkUrl);
      setLinkMsg(tr("contracts.linkCopied"));
    } catch {
      window.prompt(tr("contracts.linkCopyManual"), linkUrl);
    }
  };

  const shareLink = async () => {
    if (!linkUrl || !contract) return;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === "function") {
      try {
        await nav.share({ title: `${tr("contracts.contract")} ${contract.contractNumber}`, url: linkUrl });
        return;
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
      }
    }
    await copyLink();
  };

  const linkAction = async (action: "revoke" | "renew") => {
    if (!contract || !link) return;
    if (action === "revoke" && !window.confirm(tr("contracts.linkRevokeConfirm"))) return;
    if (action === "renew" && link.state === "active" && !window.confirm(tr("contracts.linkRenewConfirm"))) return;
    setLinkBusy(true);
    setLinkMsg("");
    setError("");
    try {
      const res = await fetch(`/api/contracts/${contract.id}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("contracts.errorSave"));
        return;
      }
      setContract((c) => (c ? { ...c, publicLink: data.data.publicLink } : c));
      setLinkMsg(action === "revoke" ? tr("contracts.linkRevoked") : tr("contracts.linkRenewed"));
    } catch {
      setError(tr("contracts.errorConnection"));
    } finally {
      setLinkBusy(false);
    }
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
  const returnDate = isNew ? draft.win?.returnDate ?? "" : s?.booking.returnDate ?? "";
  const signedCount = savedDrivers.filter((d) => d.signature).length;
  const canSignNow = !isNew && !readOnly && !locked && !dirty && form.gdprConsent;
  const [main, ...others] = form.drivers;

  const paymentSummary = [
    form.paymentMethod ? tr(`contracts.payment_${form.paymentMethod}`) : "—",
    form.depositAmount.trim()
      ? `${tr("contracts.deposit")} ${eur(Number(form.depositAmount) || 0, locale)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="dash-contract">
      {/* ── Κεφαλίδα ── */}
      <div className="dash-page-head dash-head-row">
        <div>
          <Link href="/dashboard/contracts" className="dash-back">
            <ArrowLeft size={15} /> {tr("contracts.backToList")}
          </Link>
          {contract ? (
            <>
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
            </>
          ) : (
            <>
              <h1 className="dash-page-title">{tr("walkIn.title")}</h1>
              <p className="dash-page-sub">{tr("walkIn.subtitle")}</p>
              <button type="button" className="dash-link-btn" onClick={() => setFromBooking(true)}>
                <FileSignature size={14} /> {tr("walkIn.fromBooking")}
              </button>
            </>
          )}
        </div>
        <div className="dash-contract-actions">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="dash-contract-logo" src={logoUrl} alt="" />
          )}
          {contract && (
            <a className="dash-btn" href={`/print/contracts/${contract.id}`} target="_blank" rel="noopener">
              <Printer size={16} /> {tr("contracts.print")}
            </a>
          )}
          {contract && can.delete && contract.status === "DRAFT" && !hasSignatures && (
            <button className="dash-btn dash-btn--danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={16} /> {tr("contracts.delete")}
            </button>
          )}
        </div>
      </div>

      {locked && (
        <div className="dash-contract-lock">
          <Lock size={15} /> {completed ? tr("contracts.lockedCompleted") : tr("contracts.lockedSigned")}
        </div>
      )}
      {!readOnly && !locked && hasSignatures && (
        <div className="dash-contract-warn">
          <AlertTriangle size={15} /> {tr("contracts.partialSignedWarn")}
        </div>
      )}

      {/* ── Όχημα, ημερομηνίες, τιμή ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">{tr("contracts.vehicleAndDates")}</h2>
        {isNew ? (
          <WalkInSection draft={draft} canOverride={canOverride} />
        ) : (
          <>
            <p className="dash-contract-vehicle">
              <strong>{s ? `${s.vehicle.brand} ${s.vehicle.model}` : "—"}</strong> · {s?.vehicle.plate ?? "—"} ·{" "}
              {s ? tr(`fuelType.${s.vehicle.fuel}`) : "—"}
            </p>
            <p className="dash-form-note">
              {tr("contracts.pickup")}: {s ? `${shortDate(s.booking.pickupDate, locale)} ${s.booking.pickupTime ?? ""}` : "—"}
              {" → "}
              {tr("contracts.return")}: {s ? `${shortDate(s.booking.returnDate, locale)} ${s.booking.returnTime ?? ""}` : "—"}
            </p>
          </>
        )}

        {totalChangedAfterSign && contract && (
          <div className="dash-contract-warn">
            <AlertTriangle size={15} /> {tr("contracts.totalChangedAfterSign")} (
            {eur(contract.bookingTotalNow, locale)})
          </div>
        )}
        {money ? (
          <div className="dash-contract-money">
            <div className="dash-contract-line">
              <span>
                {tr("contracts.rental")} · {money.totalDays} × {eur(money.dailyRate, locale)}
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
                    · {isNew
                      ? tr("contracts.insuranceTag")
                      : `${tr("contracts.excess")} ${x.excess === null ? tr("contracts.excessNotSet") : eur(x.excess, locale)}`}
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
                {tr("contracts.ofWhich")}: {tr("contracts.net")} {eur(vat.net, locale)} + {tr("contracts.vat")}{" "}
                {vat.vatRate}% {eur(vat.vatAmount, locale)}
              </p>
            )}
            <p className="dash-form-note">
              {isNew ? tr("walkIn.priceNote") : money.preview ? tr("contracts.previewNote") : tr("contracts.snapshotNote")}
            </p>
          </div>
        ) : (
          <p className="dash-form-note">
            {isNew ? (draft.previewing ? tr("contracts.loading") : tr("walkIn.pickVehicleFirst")) : "—"}
          </p>
        )}
      </section>

      {/* ── Κύριος οδηγός ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">{tr("contracts.mainDriver")}</h2>
        {isNew && linked && (
          <div className="dash-walkin-chosen">
            <span>
              <UserCheck size={15} /> {tr("contracts.linkedCustomer")} <strong>{linked.name}</strong>
            </span>
            <button
              type="button"
              className="dash-icon-btn"
              onClick={() => setLinked(null)}
              aria-label={tr("contracts.unlinkCustomer")}
              title={tr("contracts.unlinkCustomer")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {main && (
          <DriverCard
            driver={main}
            index={0}
            disabled={pickupReadOnly}
            canRemove={false}
            returnDate={returnDate}
            onChange={(key, value) => (isNew ? typeMain(key, value) : setDriver(main.id, key, value))}
            onRemove={() => undefined}
            suggestFor={(key) =>
              isNew && !linked && suggest.field && SUGGEST_FIELD[key] === suggest.field ? (
                <SuggestList results={suggest.results} onPick={pickCustomer} />
              ) : null
            }
            onBlurField={suggest.close}
            signed={!!savedDrivers.find((d) => d.id === main.id)?.signature}
            license={licenseBlock(main.id)}
          />
        )}
        {isNew && !linked && <p className="dash-form-note">{tr("contracts.newCustomerNote")}</p>}
        {isNew && duplicates && duplicates.length > 0 && (
          <div className="dash-contract-warn dash-walkin-dup">
            <p>
              <AlertTriangle size={15} /> {tr("walkIn.duplicateFound")}
            </p>
            <SuggestList results={duplicates} onPick={pickCustomer} />
            <button
              type="button"
              className="dash-btn"
              disabled={busy}
              onClick={() => create({ allowDuplicate: true, override: draft.hasConflict && canOverride })}
            >
              {tr("walkIn.createAnyway")}
            </button>
          </div>
        )}
      </section>

      {/* ── Επιπλέον οδηγοί (κλειστή) ── */}
      <Collapsible
        title={tr("contracts.moreDrivers")}
        count={others.length}
        open={!!open.drivers}
        onToggle={() => toggle("drivers")}
      >
        {others.length === 0 && <p className="dash-form-note">{tr("contracts.noMoreDrivers")}</p>}
        {others.map((d, i) => (
          <DriverCard
            key={d.id}
            driver={d}
            index={i + 1}
            disabled={pickupReadOnly}
            canRemove={!pickupReadOnly}
            returnDate={returnDate}
            onChange={(key, value) => setDriver(d.id, key, value)}
            onRemove={() => removeDriver(d.id)}
            signed={!!savedDrivers.find((x) => x.id === d.id)?.signature}
            license={licenseBlock(d.id)}
          />
        ))}
        {!pickupReadOnly && (
          <button className="dash-btn" onClick={addDriver}>
            <Plus size={16} /> {tr("contracts.addDriver")}
          </button>
        )}
      </Collapsible>

      {/* ── Πρόσθετα / ασφάλεια (κλειστή) ── */}
      <Collapsible
        title={tr("contracts.extrasInsurance")}
        count={form.extraIds.length}
        open={!!open.extras}
        onToggle={() => toggle("extras")}
      >
        {!extrasEditable && contract?.extrasLock && (
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
                      {e.type === "INSURANCE" && <small> · {tr("contracts.insuranceTag")}</small>}
                    </span>
                    <span className="dash-extra-pick-price">
                      {eur(e.price, locale)}
                      <small> {e.chargeType === "PER_DAY" ? tr("contracts.perDay") : tr("contracts.oneOff")}</small>
                    </span>
                  </label>
                );
              })}
          </div>
        )}
        {extrasEditable && !isNew && <p className="dash-form-note">{tr("contracts.extrasHelp")}</p>}

        {isNew && (
          <div className="dash-form-grid dash-walkin-extra-fields">
            <div className="dash-field">
              {tr("walkIn.discountCode")}
              <div className="dash-code-row">
                <input
                  value={draft.codeInput}
                  maxLength={50}
                  onChange={(e) => draft.setCodeInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && draft.applyCode()}
                />
                <button
                  type="button"
                  className="dash-btn"
                  onClick={draft.applyCode}
                  disabled={!draft.codeInput.trim()}
                >
                  {tr("walkIn.applyCode")}
                </button>
              </div>
              {draft.codeError && <span className="dash-field-error">{draft.codeError}</span>}
              {draft.appliedCode && !draft.codeError && draft.preview?.discountCode && (
                <span className="dash-form-note">
                  {tr("walkIn.codeApplied")} {draft.preview.discountCode}
                </span>
              )}
            </div>
            {(walkIn?.partners.length ?? 0) > 0 && (
              <label className="dash-field">
                {tr("walkIn.partner")}
                <select value={draft.partnerId} onChange={(e) => draft.setPartnerId(e.target.value)}>
                  <option value="">{tr("walkIn.noPartner")}</option>
                  {walkIn!.partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </Collapsible>

      {/* ── Πληρωμή, κάρτα & εγγύηση (κλειστή) ── */}
      <Collapsible
        title={tr("contracts.paymentDeposit")}
        summary={paymentSummary}
        open={!!open.payment}
        onToggle={() => toggle("payment")}
      >
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
      </Collapsible>

      {/* ── Τόπος & καύσιμο (κλειστή) ── */}
      <Collapsible
        title={tr("contracts.placeAndFuel")}
        summary={[form.pickupLocation, form.fuelPickup !== null ? `${fuelWord} ${form.fuelPickup}/8` : ""]
          .filter(Boolean)
          .join(" · ")}
        open={!!open.place}
        onToggle={() => toggle("place")}
      >
        <div className="dash-form-grid">
          <label className="dash-field">
            {tr("contracts.pickupLocation")}
            <input
              value={form.pickupLocation}
              disabled={pickupReadOnly}
              maxLength={200}
              onChange={(e) => setPickupLocation(e.target.value)}
            />
          </label>
          {!returnSame && (
            <label className="dash-field">
              {tr("contracts.returnLocation")}
              <input
                value={form.returnLocation}
                disabled={pickupReadOnly}
                maxLength={200}
                onChange={(e) => set("returnLocation", e.target.value)}
              />
            </label>
          )}
        </div>
        <label className="dash-field dash-field--check">
          <input
            type="checkbox"
            checked={returnSame}
            disabled={pickupReadOnly}
            onChange={(e) => {
              setReturnSame(e.target.checked);
              if (e.target.checked) set("returnLocation", form.pickupLocation);
            }}
          />
          {tr("contracts.returnSamePlace")}
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
        {/* Παλιά συμβόλαια: το καύσιμο παράδοσης μόνο για ανάγνωση. */}
        {contract && contract.fuelReturn !== null && (
          <>
            <span className="dash-field-label">
              {fuelWord} · {tr("contracts.atReturn")} · {tr("contracts.legacy")}
            </span>
            <FuelGauge value={contract.fuelReturn} disabled label={fuelWord} onChange={() => {}} />
          </>
        )}
      </Collapsible>

      {/* ── 📷 Ζημιές: φωτογραφίες παραλαβής / παράδοσης (κλειστή) ── */}
      <Collapsible
        title={`📷 ${tr("contracts.damagesTitle")}`}
        count={photos.length}
        showZero
        open={!!open.damages}
        onToggle={() => toggle("damages")}
      >
        {contract ? (
          <p className="dash-form-note">{tr("contracts.photosHelp")}</p>
        ) : (
          <p className="dash-form-note">{tr("contracts.saveFirstPhotos")}</p>
        )}
        <div className="dash-damage-group">
          <h3 className="dash-contract-sub">{tr("contracts.damagesPickup")}</h3>
          {contract && <PhotoManager {...photoProps(contract, "PICKUP")} />}
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
          {contract && <PhotoManager {...photoProps(contract, "RETURN")} />}
          <label className="dash-field">
            {tr("contracts.damageDescription")}
            <textarea
              className="dash-textarea"
              rows={2}
              maxLength={1000}
              value={form.damageNotesReturn}
              disabled={isNew ? false : readOnly}
              placeholder={!isNew && readOnly ? "" : tr("contracts.damageNote")}
              onChange={(e) => set("damageNotesReturn", e.target.value)}
            />
          </label>
        </div>
        {/* Παλιά συμβόλαια με σκαρίφημα: μόνο ανάγνωση, μικρό. */}
        {contract && contract.damageMarks.length > 0 && (
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
      </Collapsible>

      {/* ── Αλλαγή οχήματος (κλειστή· μόνο σε αποθηκευμένο) ── */}
      {contract && (
        <Collapsible
          title={tr("contracts.vehicleChanges")}
          count={form.vehicleChanges.length}
          open={!!open.changes}
          onToggle={() => toggle("changes")}
        >
          {form.vehicleChanges.length === 0 && <p className="dash-form-note">{tr("contracts.noVehicleChanges")}</p>}
          {form.vehicleChanges.map((c) => (
            <div key={c.id} className="dash-change-row">
              <label className="dash-field">
                {tr("contracts.newVehicle")}
                <select value={c.vehicleId} disabled={readOnly} onChange={(e) => setChange(c.id, "vehicleId", e.target.value)}>
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
                <button className="dash-icon-btn" onClick={() => removeChange(c.id)} aria-label={tr("contracts.removeChange")}>
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
        </Collapsible>
      )}

      {/* ── Παρατηρήσεις (κλειστή) ── */}
      <Collapsible
        title={tr("contracts.notes")}
        summary={form.notes.trim() ? "✓" : ""}
        open={!!open.notes}
        onToggle={() => toggle("notes")}
      >
        <textarea
          className="dash-textarea"
          rows={4}
          value={form.notes}
          disabled={isNew ? false : readOnly}
          maxLength={5000}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Collapsible>

      {/* ── Όροι (κλειστή) + GDPR (υποχρεωτικό) ── */}
      <section className="dash-panel dash-contract-section">
        <button className="dash-collapse" onClick={() => toggle("terms")} aria-expanded={!!open.terms}>
          {open.terms ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          {tr("contracts.terms")}
        </button>
        {open.terms && (
          <div className="dash-collapse-body dash-contract-terms">
            {s?.terms.el || s?.terms.en ? (
              <>
                {s.terms.el && <p>{s.terms.el}</p>}
                {s.terms.en && <p>{s.terms.en}</p>}
              </>
            ) : (
              <p className="dash-form-note">{isNew ? tr("contracts.termsAfterSave") : tr("contracts.noTerms")}</p>
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
            <span>{GDPR_TEXT.el} *</span>
            <small>{GDPR_TEXT.en}</small>
          </span>
        </label>
      </section>

      {/* ── Υπογραφές ── */}
      <section className="dash-panel dash-contract-section">
        <h2 className="dash-section-title">
          {tr("contracts.signatures")}{" "}
          <span className="dash-count">
            {signedCount}/{isNew ? form.drivers.length : savedDrivers.length}
          </span>
        </h2>
        {isNew ? (
          <p className="dash-form-note">{tr("contracts.saveFirstSign")}</p>
        ) : (
          !locked &&
          !readOnly &&
          !canSignNow && (
            <p className="dash-form-note">{dirty ? tr("contracts.saveBeforeSign") : tr("contracts.gdprBeforeSign")}</p>
          )
        )}
        {contract && (
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
        )}

        {contract?.status === "SIGNED" && can.edit && (
          <div className="dash-contract-complete">
            <button className="dash-btn dash-btn--primary" disabled={busy || dirty} onClick={complete}>
              <CheckCircle2 size={16} /> {tr("contracts.complete")}
            </button>
          </div>
        )}
        {contract && allSigned(contract.drivers) && contract.signedAt && (
          <p className="dash-form-note">
            {tr("contracts.signedAt")}{" "}
            {new Date(contract.signedAt).toLocaleString(INTL[locale] ?? "el-GR", { timeZone: "Europe/Athens" })}
          </p>
        )}
      </section>

      {/* ── Link πελάτη (μόνο μετά την υπογραφή όλων) ── */}
      {contract && link && locked && (
        <section className="dash-panel dash-contract-section">
          <h2 className="dash-section-title">
            <Link2 size={17} /> {tr("contracts.linkTitle")}
          </h2>
          <p className="dash-form-note">
            {tr(`contracts.linkState_${link.state}`)}
            {link.expiresAt && link.state === "active" && (
              <> · {tr("contracts.linkExpires")} {shortDate(link.expiresAt, locale)}</>
            )}
          </p>
          {linkUrl && <code className="dash-link-url">{linkUrl}</code>}
          <div className="dash-link-actions">
            {linkUrl && (
              <>
                <button type="button" className="dash-btn dash-btn--primary" onClick={shareLink}>
                  <Share2 size={16} /> {tr("contracts.linkShare")}
                </button>
                <button type="button" className="dash-btn" onClick={copyLink}>
                  <Copy size={16} /> {tr("contracts.linkCopy")}
                </button>
              </>
            )}
            {can.edit && link.state === "active" && (
              <button type="button" className="dash-btn dash-btn--danger" disabled={linkBusy} onClick={() => linkAction("revoke")}>
                <Ban size={16} /> {tr("contracts.linkRevoke")}
              </button>
            )}
            {can.edit && (
              <button type="button" className="dash-btn" disabled={linkBusy} onClick={() => linkAction("renew")}>
                <RefreshCw size={16} /> {tr("contracts.linkRenew")}
              </button>
            )}
          </div>
          {linkMsg && <span className="dash-count">{linkMsg}</span>}
        </section>
      )}

      {error && <div className="dash-form-error">{error}</div>}
      {notice && <div className="dash-alert-ok">{notice}</div>}

      {/* ── Μπάρα αποθήκευσης ── */}
      {isNew ? (
        <div className="dash-savebar">
          <span>{missing.length > 0 ? `${tr("contracts.missing")} ${missing.join(", ")}` : tr("contracts.readyToSave")}</span>
          {draft.hasConflict ? (
            canOverride && (
              <button
                type="button"
                className="dash-btn dash-btn--danger"
                disabled={busy || !canCreate}
                onClick={() => create({ override: true })}
              >
                {busy ? tr("contracts.saving") : tr("bookings.conflictApprove")}
              </button>
            )
          ) : (
            <button type="button" className="dash-btn dash-btn--primary" disabled={busy || !canCreate} onClick={() => create()}>
              <Save size={16} /> {busy ? tr("contracts.saving") : tr("contracts.save")}
            </button>
          )}
        </div>
      ) : (
        !readOnly &&
        dirty && (
          <div className="dash-savebar">
            <span>{tr("contracts.unsaved")}</span>
            <button className="dash-btn" disabled={busy} onClick={() => contract && setForm(fromContract(contract))}>
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
        )
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

      {fromBooking && <NewContractModal onClose={() => setFromBooking(false)} />}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Κλειστή ενότητα: μία γραμμή, ανοίγει με tap
   ───────────────────────────────────────────── */

function Collapsible({
  title,
  count,
  showZero = false,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  count?: number;
  showZero?: boolean;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`dash-panel dash-contract-section dash-fold ${open ? "open" : ""}`}>
      <button type="button" className="dash-collapse" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        <span className="dash-fold-title">
          {title}
          {count !== undefined && (count > 0 || showZero) && <span className="dash-count"> ({count})</span>}
        </span>
        {summary && !open && <span className="dash-fold-summary">{summary}</span>}
      </button>
      {open && <div className="dash-collapse-body">{children}</div>}
    </section>
  );
}

/* ─────────────────────────────────────────────
   Οδηγός: τα βασικά πάντα ορατά, τα υπόλοιπα με «Περισσότερα»
   ───────────────────────────────────────────── */

function DriverCard({
  driver: d,
  index,
  disabled,
  canRemove,
  returnDate,
  onChange,
  onRemove,
  suggestFor,
  onBlurField,
  signed,
  license,
}: {
  driver: ContractDriver;
  index: number;
  disabled: boolean;
  canRemove: boolean;
  returnDate: string;
  onChange: (key: keyof ContractDriver, value: string) => void;
  onRemove: () => void;
  /** Λίστα υπαρχόντων πελατών κάτω από το πεδίο (μόνο κύριος οδηγός, νέο). */
  suggestFor?: (key: keyof ContractDriver) => ReactNode;
  onBlurField?: () => void;
  signed: boolean;
  license: ReactNode;
}) {
  const tr = useT();
  const locale = useLocale();
  // Τα σπάνια πεδία κρυμμένα· ανοιχτά αν έχουν ήδη τιμή όταν ανοίγει η φόρμα.
  const [more, setMore] = useState(() => !!(d.country || d.birthDate || d.licenseExpiry));
  const expiring = licenseExpiresBeforeReturn(d.licenseExpiry, returnDate);
  const required = index === 0;

  const input = (
    key: "fullName" | "phone" | "email" | "idNumber" | "licenseNumber" | "address" | "country",
    label: string,
    extra: { type?: string; wide?: boolean; req?: boolean; max?: number; inputMode?: "tel" | "email" } = {}
  ) => (
    <label className={`dash-field dash-suggest-anchor ${extra.wide ? "dash-field--wide" : ""}`}>
      {label}
      {extra.req ? " *" : ""}
      <input
        type={extra.type ?? "text"}
        value={d[key]}
        disabled={disabled}
        maxLength={extra.max ?? 200}
        autoComplete="off"
        onChange={(e) => onChange(key, e.target.value)}
        onBlur={onBlurField}
      />
      {suggestFor?.(key)}
    </label>
  );

  return (
    <div className="dash-driver">
      {/* Ο κύριος οδηγός έχει ήδη τον τίτλο της ενότητας. */}
      {(index > 0 || signed) && (
      <div className="dash-driver-head">
        <strong>{index === 0 ? tr("contracts.mainDriver") : `${tr("contracts.driver")} ${index + 1}`}</strong>
        {signed && <span className="dash-status dash-status--ok">{tr("contracts.signed")}</span>}
        {canRemove && (
          <button
            className="dash-icon-btn"
            onClick={onRemove}
            aria-label={tr("contracts.removeDriver")}
            title={tr("contracts.removeDriver")}
          >
            <X size={16} />
          </button>
        )}
      </div>
      )}
      <div className="dash-form-grid">
        {input("fullName", tr("contracts.fullName"), { req: true })}
        {input("phone", tr("contracts.phone"), { type: "tel", req: required, max: 50 })}
        {input("email", tr("contracts.email"), { type: "email" })}
        <label className="dash-field">
          {tr("contracts.idType")}
          <select value={d.idType} disabled={disabled} onChange={(e) => onChange("idType", e.target.value)}>
            {ID_TYPES.map((t) => (
              <option key={t} value={t}>
                {tr(`contracts.idType_${t}`)}
              </option>
            ))}
          </select>
        </label>
        {input("idNumber", tr("contracts.idNumber"), { max: 100 })}
        {input("licenseNumber", tr("contracts.licenseNumber"), { max: 100 })}
        {input("address", tr("contracts.address"), { wide: true, max: 500 })}
      </div>
      <button type="button" className="dash-link-btn" onClick={() => setMore((m) => !m)} aria-expanded={more}>
        {more ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {tr("contracts.moreDetails")}
      </button>
      {more && (
        <div className="dash-form-grid dash-driver-more">
          <label className="dash-field">
            {tr("contracts.licenseExpiry")}
            <input
              type="date"
              value={d.licenseExpiry}
              disabled={disabled}
              onChange={(e) => onChange("licenseExpiry", e.target.value)}
            />
          </label>
          <label className="dash-field">
            {tr("contracts.birthDate")}
            <input
              type="date"
              value={d.birthDate}
              disabled={disabled}
              onChange={(e) => onChange("birthDate", e.target.value)}
            />
          </label>
          {input("country", tr("contracts.country"), { max: 100 })}
        </div>
      )}
      {expiring && (
        <div className="dash-contract-warn">
          <AlertTriangle size={15} /> {tr("contracts.licenseExpiresWarn")} ({shortDate(returnDate, locale)})
        </div>
      )}
      {license}
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
