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
// · Στο νέο συμβόλαιο συμπληρώνονται ΟΛΑ πριν την πρώτη αποθήκευση εκτός
//   από τις υπογραφές. Οι φωτογραφίες (ζημιές, διπλώματα) μένουν ΜΟΝΟ στη
//   μνήμη του browser (stagedPhotos.ts) και ανεβαίνουν μία-μία με τα
//   υπάρχοντα endpoints αμέσως μετά την αποθήκευση.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  Mail,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  CONTRACT_STATUS_CLASS,
  DEPOSIT_METHODS,
  GDPR_TEXT,
  ID_TYPES,
  PAYMENT_METHODS,
  CONTRACT_FUEL_TYPES,
  type ContractFuelType,
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
import { publicContractUrl, type PublicLinkDTO } from "@/lib/contractLink";
import { isEmail, suggestEmailLang, type EmailLang } from "@/lib/contractEmail";
import { computePrice, toDisplayBreakdown, type PricedExtraInput } from "@/lib/pricing";
import { splitVatInclusive } from "@/lib/invoices";
import {
  PRICE_REASON_MAX,
  withManualRental,
  computedTotalOf,
  validManualPrice,
} from "@/lib/priceOverride";
import { phoneDigits, type CustomerSearchField } from "@/lib/customerMatch";
import type { ExtraDTO } from "@/lib/extras";
import type { WalkInCustomer } from "@/lib/walkIn";
import DamageSketch from "@/components/contracts/DamageSketch";
import FuelGauge from "@/components/contracts/FuelGauge";
import SignaturePad from "@/components/contracts/SignaturePad";
import VehiclePicker, { type PickerVehicle } from "@/components/contracts/VehiclePicker";
import PhotoManager, { type StagedView } from "@/components/photos/PhotoManager";
import { MAX_CONTRACT_PHOTOS, type PhotoItem } from "@/lib/photoShared";
import { sendPhoto, uploadErrorFor } from "@/lib/photoUpload";
import {
  pruneForDrivers,
  roomFor,
  sameTarget,
  stagedFor,
  uploadAll,
  uploadRequest,
  type StageTarget,
  type StagedPhoto,
} from "@/lib/stagedPhotos";
import NewContractModal from "../NewContractModal";
import { WalkInSection, eur, useWalkInDraft, windowValid } from "./WalkInSection";
import { LocationFields } from "./LocationFields";
import {
  groupCardNumber,
  maskedCardNumber,
  normalizeCardNumber,
  type CardKind,
} from "@/lib/cardNumber";
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
  brand: string;
  model: string;
  plate: string;
  dailyRate: number;
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
  /** Τύπος καυσίμου — χωρίς προεπιλογή (null). */
  fuelType: ContractFuelType | null;
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
  /**
   * Χειροκίνητη τιμή ΕΝΟΙΚΙΟΥ με ΦΠΑ (contracts.price) ή null = υπολογισμένη.
   * Σύνολο = ενοίκιο + πρόσθετα + ασφάλεια − έκπτωση.
   * `base` = το υπολογισμένο ενοίκιο όταν ορίστηκε (για την προειδοποίηση).
   */
  price: { rental: string; reason: string; base?: number } | null;
}

/**
 * Κάρτα στη φόρμα. `number` = ΝΕΟΣ πλήρης αριθμός που πληκτρολογήθηκε
 * (κενό = μένει ό,τι υπάρχει)· πάει μόνο στον server, που τον κρυπτογραφεί.
 * `last4` = τα αποθηκευμένα 4 τελευταία (για τη μάσκα). Ποτέ CVV.
 */
interface CardForm {
  brand: string;
  number: string;
  last4: string;
  holder: string;
  expiry: string;
}

const emptyCard = (): CardForm => ({ brand: "VISA", number: "", last4: "", holder: "", expiry: "" });
const cardFromDTO = (c: CardInfo | null): CardForm => (c ? { ...c, number: "" } : emptyCard());

/** Ο νέος πλήρης αριθμός για τον server, μόνο όταν πληκτρολογήθηκε. */
const cardNumberPayload = (c: CardForm, uses: boolean) =>
  uses && c.number.trim() ? c.number : undefined;

/** Κενή κάρτα → null. Μερικώς συμπληρωμένη → στέλνεται και την ελέγχει ο server. */
const cardPayload = (c: CardForm): CardInfo | null => {
  // Με νέο αριθμό, τα 4 τελευταία βγαίνουν από αυτόν (το ίδιο κάνει ο server).
  const digits = normalizeCardNumber(c.number);
  const last4 = digits ? digits.slice(-4) : c.last4.trim();
  return last4 || c.number.trim() || c.holder.trim() || c.expiry.trim()
    ? {
        brand: c.brand as CardInfo["brand"],
        last4,
        holder: c.holder.trim(),
        expiry: c.expiry.trim(),
      }
    : null;
};

/** Η κάρτα είναι έγκυρη για αποθήκευση (κενή = εντάξει). */
const cardValid = (c: CardForm) =>
  cardPayload(c) === null ||
  ((c.number.trim() ? !!normalizeCardNumber(c.number) : LAST4_RE.test(c.last4)) &&
    CARD_EXPIRY_RE.test(c.expiry));

const fromContract = (c: ContractDTO): FormState => ({
  drivers: c.drivers,
  pickupLocation: c.pickupLocation,
  returnLocation: c.returnLocation,
  fuelType: c.fuelType,
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
  // Το DTO έχει πάντα manualRental (και για την παλιά μορφή «τελικό σύνολο»).
  price:
    c.snapshot?.priceOverride?.manualRental !== undefined
      ? {
          rental: String(c.snapshot.priceOverride.manualRental),
          reason: c.snapshot.priceOverride.reason ?? "",
          base: c.snapshot.priceOverride.computedRental,
        }
      : null,
});

/** Νέο συμβόλαιο: προεπιλογές — μετρητά, εγγύηση χωρίς ποσό, ένας οδηγός. */
const newForm = (): FormState => ({
  drivers: [emptyDriver(randomId())],
  pickupLocation: "",
  returnLocation: "",
  fuelType: null,
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
  price: null,
});

const driverPayload = (drivers: ContractDriver[]) =>
  drivers.map(({ signature: _s, signedAt: _a, licensePhotos: _l, ...rest }) => rest);

/** Τα στοιχεία παραλαβής — ό,τι κλειδώνει με την υπογραφή όλων. */
const pickupPart = (f: FormState) =>
  JSON.stringify({
    drivers: driverPayload(f.drivers),
    pickupLocation: f.pickupLocation,
    returnLocation: f.returnLocation,
    fuelType: f.fuelType,
    fuelPickup: f.fuelPickup,
    damageNotesPickup: f.damageNotesPickup,
    paymentMethod: f.paymentMethod,
    depositAmount: f.depositAmount,
    depositMethod: f.depositMethod,
    paymentCard: paymentUsesCard(f.paymentMethod) ? cardPayload(f.paymentCard) : null,
    depositCard: depositUsesCard(f.depositMethod) ? cardPayload(f.depositCard) : null,
    paymentCardNumber: cardNumberPayload(f.paymentCard, paymentUsesCard(f.paymentMethod)),
    depositCardNumber: cardNumberPayload(f.depositCard, depositUsesCard(f.depositMethod)),
    gdprConsent: f.gdprConsent,
  });

const extrasPart = (f: FormState) => f.extraIds.join(",");

/** Η χειροκίνητη τιμή όπως τη στέλνει ο client: ΜΟΝΟ ενοίκιο + λόγος. */
const pricePayload = (f: FormState) =>
  f.price ? { rental: Number(f.price.rental), reason: f.price.reason.trim() } : null;
const pricePart = (f: FormState) => JSON.stringify(pricePayload(f));

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
  fuelType: f.fuelType,
  fuelPickup: f.fuelPickup,
  damageNotesPickup: f.damageNotesPickup,
  paymentMethod: f.paymentMethod || null,
  depositAmount: f.depositAmount.trim() === "" ? null : Number(f.depositAmount),
  depositMethod: f.depositMethod || null,
  paymentCard: paymentUsesCard(f.paymentMethod) ? cardPayload(f.paymentCard) : null,
  depositCard: depositUsesCard(f.depositMethod) ? cardPayload(f.depositCard) : null,
  paymentCardNumber: cardNumberPayload(f.paymentCard, paymentUsesCard(f.paymentMethod)),
  depositCardNumber: cardNumberPayload(f.depositCard, depositUsesCard(f.depositMethod)),
  gdprConsent: f.gdprConsent,
});

/** Το σώμα του PATCH. Σε υπογεγραμμένο στέλνουμε μόνο ό,τι επιτρέπεται. */
function toPayload(f: FormState, locked: boolean, sendExtras: boolean, sendPrice: boolean) {
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
    ...(sendPrice && { priceOverride: pricePayload(f) }),
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
    vehicleChanges: f.vehicleChanges,
    notes: f.notes,
    ...(f.price && { priceOverride: pricePayload(f) }),
  };
}

const toView = (p: StagedPhoto): StagedView => ({
  key: p.key,
  previewUrl: p.previewUrl,
  takenAt: p.takenAt,
  note: p.note,
  status: p.status,
  message: p.message,
});

/** Υποχρεωτικά πεδία (με αστερίσκο) της φόρμας. */
type RequiredKey = "name" | "phone" | "dates" | "vehicle";

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
  locations,
  walkIn,
  emailSent = null,
}: {
  /** null = νέο συμβόλαιο (walk-in), πριν την πρώτη αποθήκευση. */
  initialContract: ContractDTO | null;
  vehicles: VehicleOption[];
  /** Τα πρόσθετα της εταιρίας (και ανενεργά, για όσα έχει ήδη η κράτηση). */
  extras: ExtraDTO[];
  vatRate: number;
  roundUpTotal: boolean;
  /** price = contracts.price (αλλαγή τελικής τιμής). */
  /** revealCard = Διαχειριστής: βλέπει τον πλήρη αριθμό κάρτας με «Εμφάνιση». */
  /** sendEmail = Διαχειριστής/Προσωπικό: «Αποστολή στον πελάτη». */
  can: { edit: boolean; delete: boolean; price: boolean; revealCard: boolean; sendEmail?: boolean };
  /** Τρέχον λογότυπο εταιρίας (signed URL) ή null. */
  logoUrl: string | null;
  /** Σημεία παραλαβής/επιστροφής της εταιρίας (tenantLocations). */
  locations: string[];
  /** Μόνο στο νέο συμβόλαιο. Κενό `partners` για συνεργάτη. */
  walkIn?: { partners: { id: string; name: string }[]; canOverride: boolean };
  /** Τελευταία επιτυχής αποστολή στον πελάτη (email + PDF). */
  emailSent?: { sentAt: string; sentTo: string } | null;
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
  const [lastEmail, setLastEmail] = useState(emailSent);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailLang, setEmailLang] = useState<EmailLang>(() =>
    suggestEmailLang(initialContract?.drivers[0]?.country)
  );
  // Κλειστές ενότητες: όλες κλειστές από προεπιλογή.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  // Επιστροφή στον ίδιο χώρο: προεπιλογή στο νέο· στο παλιό μόνο αν ήδη ίδιοι.
  const [returnSame, setReturnSame] = useState(
    () => !initialContract || initialContract.returnLocation === initialContract.pickupLocation
  );
  const [fromBooking, setFromBooking] = useState(false);

  /* ── Φωτογραφίες που περιμένουν την αποθήκευση (μόνο στη μνήμη) ── */
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const stagedRef = useRef<StagedPhoto[]>([]);
  stagedRef.current = staged;
  // Τα object URLs ελευθερώνονται όταν φεύγει η σελίδα.
  useEffect(() => () => stagedRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);
  // Μη ανεβασμένες φωτογραφίες → προειδοποίηση πριν φύγει ο χρήστης.
  const hasPending = staged.length > 0;
  useEffect(() => {
    if (!hasPending) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasPending]);

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
  const priceDirty = saved ? pricePart(form) !== pricePart(saved) : false;
  const dirty = saved
    ? pickupDirty || extrasDirty || priceDirty || afterPart(form) !== afterPart(saved)
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
        parts: p.parts,
        computed: p.display.total,
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
        parts: s.booking,
        computed: computedTotalOf(s.booking, roundUpTotal),
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
      parts: b,
      computed: b.total,
    };
  }, [isNew, draft.preview, s, extras, extrasDirty, form.extraIds, roundUpTotal, vatRate]);

  /* ── Χειροκίνητο ενοίκιο: σύνολο = ενοίκιο + πρόσθετα + ασφάλεια − έκπτωση ──
     Τα πρόσθετα (και στην προεπισκόπηση) αλλάζουν αμέσως το σύνολο. */
  const manualRental =
    form.price && validManualPrice(Number(form.price.rental)) ? Number(form.price.rental) : null;
  const shown = money
    ? manualRental !== null
      ? withManualRental(money.parts, manualRental)
      : money.display
    : null;
  const savedOverride = contract?.snapshot?.priceOverride;
  // Το υπολογισμένο ενοίκιο άλλαξε (ημερομηνίες/όχημα) από τότε που ορίστηκε.
  const priceStale =
    manualRental !== null &&
    !!money &&
    form.price?.base !== undefined &&
    Math.abs(form.price.base - money.parts.subtotal) > 0.004;
  // Ίδιο κλείδωμα με τα πρόσθετα: υπογραφή / τιμολόγιο / κλειστή κράτηση.
  const priceLock = isNew ? null : locked ? "signed" : contract?.extrasLock ?? null;
  const canChangePrice = can.price && !readOnly && priceLock === null;
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceDraft, setPriceDraft] = useState({ rental: "", reason: "" });
  const priceDraftValid =
    validManualPrice(Number(priceDraft.rental)) && priceDraft.reason.length <= PRICE_REASON_MAX;

  const vat = shown && money ? splitVatInclusive(shown.total, money.vatRate) : null;
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

  /* ── Υποχρεωτικά πεδία (με αστερίσκο) ──
     1ο πάτημα με ελλιπή: ΔΕΝ αποθηκεύει, κοκκινίζει, scroll + focus στο πρώτο.
     2ο συνεχόμενο πάτημα: αποθηκεύει ούτως ή άλλως. Το κόκκινο κάθε πεδίου
     φεύγει μόλις συμπληρωθεί. Όχημα/ημερομηνίες μόνο στο νέο (μετά ζουν
     στην κράτηση)· όνομα/τηλέφωνο όσο τα στοιχεία παραλαβής αλλάζουν. */
  const nameOk = (form.drivers[0]?.fullName ?? "").trim().length > 0;
  const phoneOk = phoneDigits(form.drivers[0]?.phone ?? "").length >= 5;
  const missingReq = (
    [
      !pickupReadOnly && !nameOk && "name",
      !pickupReadOnly && !phoneOk && "phone",
      isNew && !windowValid(draft.win) && "dates",
      isNew && !draft.vehicleId && "vehicle",
    ] as const
  ).filter((x): x is RequiredKey => !!x);
  const [showRequired, setShowRequired] = useState(false);
  const [requiredWarned, setRequiredWarned] = useState(false);
  const requiredError = (k: RequiredKey) =>
    showRequired && missingReq.includes(k) ? tr(`contracts.required_${k}`) : undefined;
  const changesIncomplete = form.vehicleChanges.some((c) => !c.vehicleId || !c.date);

  /** Κάθε πάτημα «Αποθήκευση» περνά από εδώ. */
  const attemptSave = (run: () => void) => {
    if (missingReq.length > 0 && !requiredWarned) {
      setRequiredWarned(true);
      setShowRequired(true);
      setError("");
      // Οι ενότητες με υποχρεωτικά (οδηγός, όχημα & ημερομηνίες) είναι πάντα
      // ανοιχτές· scroll + focus στο πρώτο κενό πεδίο του πρώτου που λείπει.
      requestAnimationFrame(() => {
        const box = document.querySelector<HTMLElement>(`[data-required="${missingReq[0]}"]`);
        if (!box) return;
        const inputs = box.matches("input")
          ? [box as HTMLInputElement]
          : Array.from(box.querySelectorAll<HTMLInputElement>("input:not([disabled])"));
        const target = inputs.find((i) => !i.value) ?? inputs[0];
        box.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
      });
      return;
    }
    if (cardsInvalid || changesIncomplete) {
      setError(tr("contracts.fixBeforeSave"));
      return;
    }
    run();
  };
  const requiredDone = () => {
    setShowRequired(false);
    setRequiredWarned(false);
  };

  /* ── «Εμφάνιση» πλήρους αριθμού κάρτας (μόνο Διαχειριστής) ── */
  const revealFor = (kind: CardKind) =>
    can.revealCard && contract?.cardNumberSaved[kind]
      ? async (): Promise<string | null> => {
          try {
            const res = await fetch(`/api/contracts/${contract.id}/card-number?kind=${kind}`, {
              cache: "no-store",
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
              setError(body.message || tr("contracts.errorConnection"));
              return null;
            }
            return body.data.number as string;
          } catch {
            setError(tr("contracts.errorConnection"));
            return null;
          }
        }
      : undefined;

  /* ── Staged φωτογραφίες: προσθήκη/αφαίρεση πριν την αποθήκευση ── */
  const stage = (target: StageTarget) => (blob: Blob, takenAt: string) =>
    setStaged((list) => [
      ...list,
      {
        key: randomId(),
        target,
        blob,
        previewUrl: URL.createObjectURL(blob),
        takenAt,
        note: "",
        status: "staged",
        message: "",
      },
    ]);
  const unstage = (key: string) =>
    setStaged((list) => {
      list.filter((p) => p.key === key).forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return list.filter((p) => p.key !== key);
    });
  const noteStaged = (key: string, note: string) =>
    setStaged((list) => list.map((p) => (p.key === key ? { ...p, note } : p)));

  /** Ανεβάζει ΜΙΑ staged φωτογραφία με το υπάρχον endpoint (ίδιοι κανόνες/μηνύματα). */
  const uploadOne = async (contractId: string, p: StagedPhoto) => {
    setStaged((list) => list.map((x) => (x.key === p.key ? { ...x, status: "uploading", message: "" } : x)));
    const { url, fields } = uploadRequest(contractId, p);
    const form = new FormData();
    form.append("file", p.blob, "photo.jpg");
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    let outcome: { ok: true; result: PhotoItem } | { ok: false; message: string };
    try {
      const res = await sendPhoto(url, form, () => undefined);
      outcome =
        res.status >= 200 && res.status < 300 && res.body.data?.photo
          ? { ok: true, result: res.body.data.photo }
          : { ok: false, message: res.body.message || uploadErrorFor(res.status, tr) };
    } catch {
      outcome = { ok: false, message: tr("photos.errorConnection") };
    }
    if (outcome.ok) {
      const photo = outcome.result;
      if (p.target.kind === "damage") {
        const group = p.target.group;
        setPhotos((list) => [...list, { ...photo, group }]);
      } else {
        const driverId = p.target.driverId;
        setLicenses((list) => [...list, { driverId, id: photo.id, url: photo.url }]);
      }
      URL.revokeObjectURL(p.previewUrl);
      setStaged((list) => list.filter((x) => x.key !== p.key));
    } else {
      const message = outcome.message;
      setStaged((list) => list.map((x) => (x.key === p.key ? { ...x, status: "error", message } : x)));
    }
    return outcome;
  };

  /** Μετά την πρώτη αποθήκευση: όλες οι staged, μία-μία, με πρόοδο. */
  const uploadStaged = async (contractId: string, items: StagedPhoto[]) => {
    if (items.length === 0) return 0;
    setUploadProgress({ done: 0, total: items.length });
    const result = await uploadAll(
      items,
      (p) => uploadOne(contractId, p),
      (done, total) => setUploadProgress({ done, total })
    );
    setUploadProgress(null);
    return result.failed.length;
  };

  const create = async (opts: { override?: boolean; allowDuplicate?: boolean } = {}) => {
    if (busy || !isNew) return;
    // Η κράτηση δεν γίνεται χωρίς όχημα και ημερομηνίες — ούτε «ούτως ή άλλως».
    if (!windowValid(draft.win) || !draft.vehicleId) {
      setError(tr("contracts.needVehicleDates"));
      return;
    }
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
      requiredDone();
      // Η ίδια φόρμα μένει ανοιχτή· μόνο η διεύθυνση γίνεται του συμβολαίου.
      window.history.replaceState(null, "", `/dashboard/contracts/${next.id}`);
      // Οι φωτογραφίες ανεβαίνουν ΤΩΡΑ (υπάρχει contractId). Οδηγοί που δεν
      // αποθηκεύτηκαν δεν έχουν πια φωτογραφίες εδώ (pruneForDrivers).
      const pending = pruneForDrivers(stagedRef.current, next.drivers.map((d) => d.id));
      setBusy(false);
      const failed = await uploadStaged(next.id, pending);
      setNotice(failed > 0 ? tr("contracts.uploadsFailed") : tr("contracts.createdNotice"));
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
            extrasDirty && extrasEditable,
            priceDirty
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
      requiredDone();
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
  const removeDriver = (id: string) => {
    setForm((f) => ({ ...f, drivers: f.drivers.filter((d) => d.id !== id) }));
    // Οι staged φωτογραφίες διπλώματος του οδηγού φεύγουν μαζί του.
    setStaged((list) => {
      list
        .filter((p) => p.target.kind === "license" && p.target.driverId === id)
        .forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return list.filter((p) => !(p.target.kind === "license" && p.target.driverId === id));
    });
  };

  /* ── Φωτογραφίες: κοινά για staged (νέο) και ανεβασμένες ── */
  const uploadedCount = {
    damages: photos.length,
    licensesOf: (id: string) => licenses.filter((l) => l.driverId === id).length,
  };
  /** Τα props των staged φωτογραφιών ενός στόχου (πριν ή μετά την αποθήκευση). */
  const stagedProps = (target: StageTarget, staging: boolean) => ({
    staged: stagedFor(staged, target).map(toView),
    onStagedRemove: unstage,
    onStagedNote: noteStaged,
    onStagedRetry: (key: string) => {
      const p = staged.find((x) => x.key === key && sameTarget(x.target, target));
      if (p && contract) void uploadOne(contract.id, p);
    },
    ...(staging && { onStage: stage(target) }),
  });

  /* ── Φωτογραφίες ζημιών ── */
  const photoProps = (group: PhotoGroup) => {
    const target: StageTarget = { kind: "damage", group };
    const lock = contract ? photoLockOf(group, contract.status, contract.drivers) : null;
    const inGroup = photos.filter((p) => p.group === group);
    const total = photos.length + staged.filter((p) => p.target.kind === "damage").length;
    return {
      photos: inGroup,
      uploadUrl: contract ? `/api/contracts/${contract.id}/photos` : "",
      fields: { group },
      itemUrl: (id: string) => (contract ? `/api/contracts/${contract.id}/photos/${id}` : ""),
      editable: can.edit && lock === null,
      withNotes: true,
      // Όριο ανά συμβόλαιο: όσες χωράνε ακόμα, με τις staged όλων των ομάδων.
      max: roomFor(target, staged, uploadedCount) + inGroup.length + stagedFor(staged, target).length,
      lockedText: lock ? tr(`contracts.photosLock_${lock}`) : undefined,
      counter: `${total}/${MAX_CONTRACT_PHOTOS}`,
      onAdded: (p: PhotoItem) => setPhotos((list) => [...list, { ...p, group }]),
      onRemoved: (id: string) => setPhotos((list) => list.filter((p) => p.id !== id)),
      onNoted: (id: string, note: string) =>
        setPhotos((list) => list.map((p) => (p.id === id ? { ...p, note } : p))),
      ...stagedProps(target, !contract),
    };
  };

  /* ── Φωτογραφίες διπλώματος (ΜΟΝΟ εσωτερικά) ── */
  const savedDriverIds = new Set(savedDrivers.map((d) => d.id));
  const licenseProps = (driverId: string) => {
    const target: StageTarget = { kind: "license", driverId };
    const uploadLock = contract ? licenseLockOf("upload", contract.status, contract.drivers) : null;
    const deleteLock = contract ? licenseLockOf("delete", contract.status, contract.drivers) : null;
    const lock = uploadLock ?? deleteLock;
    const mine = licenses.filter((l) => l.driverId === driverId);
    return {
      photos: mine.map((l) => ({ id: l.id, url: l.url, takenAt: null, note: "" })),
      uploadUrl: contract ? `/api/contracts/${contract.id}/licenses` : "",
      fields: { driverId },
      itemUrl: (id: string) =>
        contract
          ? `/api/contracts/${contract.id}/licenses?driverId=${encodeURIComponent(driverId)}&photoId=${encodeURIComponent(id)}`
          : "",
      editable: can.edit && uploadLock === null,
      canDelete: can.edit && deleteLock === null,
      withNotes: false,
      max: MAX_LICENSE_PHOTOS,
      lockedText: can.edit && lock ? tr(`contracts.licenseLock_${lock}`) : undefined,
      onAdded: (p: PhotoItem) => setLicenses((list) => [...list, { driverId, id: p.id, url: p.url }]),
      onRemoved: (id: string) =>
        setLicenses((list) => list.filter((l) => !(l.driverId === driverId && l.id === id))),
      onNoted: () => undefined,
      ...stagedProps(target, !contract),
    };
  };

  const licenseBlock = (driverId: string) => (
    <div className="dash-license">
      <h3 className="dash-license-title">{tr("contracts.license")}</h3>
      {/* Νέο συμβόλαιο: staged. Αποθηκευμένο: άμεσο ανέβασμα. Νέος οδηγός σε
          ΗΔΗ αποθηκευμένο συμβόλαιο: πρώτα αποθήκευση (υπάρχει contractId). */}
      {!contract || savedDriverIds.has(driverId) ? (
        <PhotoManager {...licenseProps(driverId)} />
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
      ? publicContractUrl(origin, link.token)
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

  /* ── Αποστολή στον πελάτη (email + PDF) ── */
  // Ίδιοι έλεγχοι με τον server· ο server αποφασίζει πάντα.
  const customerEmail = contract?.drivers[0]?.email.trim() ?? "";
  const emailBlock: string | null = !contract
    ? null
    : contract.status === "DRAFT"
      ? tr("contracts.emailNotSigned")
      : !isEmail(customerEmail)
        ? tr("contracts.emailMissing")
        : link?.state !== "active"
          ? tr("contracts.emailLinkInactive")
          : null;

  const sendEmail = async () => {
    if (!contract || emailBlock) return;
    setEmailBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/contracts/${contract.id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: emailLang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || tr("contracts.errorSave"));
        return;
      }
      setLastEmail({ sentAt: data.data.sentAt, sentTo: data.data.sentTo });
    } catch {
      setError(tr("contracts.errorConnection"));
    } finally {
      setEmailBusy(false);
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

  const changeVehicles: PickerVehicle[] = useMemo(
    () => vehicles.map((v) => ({ ...v, available: true })),
    [vehicles]
  );
  // Στο νέο συμβόλαιο οι αλλαγές οχήματος γράφονται μαζί με την πρώτη αποθήκευση.
  const changesReadOnly = isNew ? false : readOnly;
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
          <Link
            href="/dashboard/contracts"
            className="dash-back"
            onClick={(e) => {
              // Μη ανεβασμένες φωτογραφίες χάνονται αν φύγεις.
              if (hasPending && !window.confirm(tr("contracts.photosPendingLeave"))) e.preventDefault();
            }}
          >
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
        <LocationFields
          pickup={form.pickupLocation}
          ret={form.returnLocation}
          returnSame={returnSame}
          locations={locations}
          disabled={pickupReadOnly}
          onPickup={setPickupLocation}
          onReturn={(v) => {
            // Χειροκίνητη αλλαγή της επιστροφής: δεν είναι πια «ίδιο σημείο».
            setReturnSame(false);
            set("returnLocation", v);
          }}
          onReturnSame={(same) => {
            setReturnSame(same);
            if (same) set("returnLocation", form.pickupLocation);
          }}
        />
        {isNew ? (
          <WalkInSection
            draft={draft}
            canOverride={canOverride}
            requiredErrors={{ dates: requiredError("dates"), vehicle: requiredError("vehicle") }}
          />
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
        {money && shown ? (
          <div className="dash-contract-money">
            <div className="dash-contract-line">
              <span>
                {tr("contracts.rental")} · {money.totalDays}
                {/* Χειροκίνητη τιμή: το ενοίκιο δεν είναι πια ημέρες × τιμή. */}
                {manualRental !== null ? ` ${tr("bookings.days")}` : ` × ${eur(money.dailyRate, locale)}`}
              </span>
              <span>{eur(shown.subtotal, locale)}</span>
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
            {shown.discountAmount > 0 && (
              <div className="dash-contract-line">
                <span>{tr("contracts.discount")}</span>
                <span>−{eur(shown.discountAmount, locale)}</span>
              </div>
            )}
            <div className="dash-contract-line dash-contract-total">
              <span>
                {tr("contracts.total")}
                {manualRental !== null && (
                  <span className="dash-status dash-status--warn dash-price-tag">{tr("contracts.manualPrice")}</span>
                )}
              </span>
              <span>{eur(shown.total, locale)}</span>
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

            {/* ── Αλλαγή τιμής (contracts.price) ── */}
            {manualRental !== null && savedOverride && !priceDirty && (
              <p className="dash-form-note dash-price-who">
                {tr("contracts.priceSetBy")} {savedOverride.userName || "—"}
                {savedOverride.at &&
                  ` · ${new Date(savedOverride.at).toLocaleString(INTL[locale] ?? "el-GR", { timeZone: "Europe/Athens" })}`}
                {savedOverride.reason && ` · ${savedOverride.reason}`}
              </p>
            )}
            {priceStale && (
              <div className="dash-contract-warn">
                <AlertTriangle size={15} /> {tr("contracts.priceStale")} ({eur(money.parts.subtotal, locale)})
                {canChangePrice && (
                  <button type="button" className="dash-link-btn" onClick={() => set("price", null)}>
                    {tr("contracts.priceReset")}
                  </button>
                )}
              </div>
            )}
            {can.price && priceLock && (
              <p className="dash-form-note">
                <Lock size={13} /> {tr(`contracts.priceLock_${priceLock}`)}
              </p>
            )}
            {canChangePrice && !priceOpen && (
              <div className="dash-price-actions">
                <button
                  type="button"
                  className="dash-btn dash-btn--sm"
                  onClick={() => {
                    setPriceDraft({
                      rental: form.price?.rental ?? shown.subtotal.toFixed(2),
                      reason: form.price?.reason ?? "",
                    });
                    setPriceOpen(true);
                  }}
                >
                  {tr("contracts.priceChange")}
                </button>
                {form.price && (
                  <button type="button" className="dash-link-btn" onClick={() => set("price", null)}>
                    {tr("contracts.priceReset")}
                  </button>
                )}
              </div>
            )}
            {canChangePrice && priceOpen && (
              <div className="dash-card-box dash-price-box">
                <div className="dash-form-grid">
                  <label className="dash-field">
                    {tr("contracts.priceRental")}
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      value={priceDraft.rental}
                      onChange={(e) => setPriceDraft((d) => ({ ...d, rental: e.target.value }))}
                    />
                  </label>
                  <label className="dash-field dash-field--wide">
                    {tr("contracts.priceReason")}
                    <input
                      maxLength={PRICE_REASON_MAX}
                      value={priceDraft.reason}
                      onChange={(e) => setPriceDraft((d) => ({ ...d, reason: e.target.value }))}
                    />
                  </label>
                </div>
                {priceDraft.rental !== "" && !validManualPrice(Number(priceDraft.rental)) && (
                  <span className="dash-field-error">{tr("contracts.priceInvalid")}</span>
                )}
                <div className="dash-price-actions">
                  <button
                    type="button"
                    className="dash-btn dash-btn--primary"
                    disabled={!priceDraftValid}
                    onClick={() => {
                      set("price", {
                        rental: Number(priceDraft.rental).toFixed(2),
                        reason: priceDraft.reason.trim(),
                        base: money.parts.subtotal,
                      });
                      setPriceOpen(false);
                    }}
                  >
                    {tr("contracts.priceApply")}
                  </button>
                  <button
                    type="button"
                    className="dash-btn"
                    onClick={() => {
                      set("price", null);
                      setPriceOpen(false);
                    }}
                  >
                    {tr("contracts.priceReset")}
                  </button>
                  <button type="button" className="dash-btn" onClick={() => setPriceOpen(false)}>
                    {tr("contracts.cancel")}
                  </button>
                </div>
                <p className="dash-form-note">{tr("contracts.priceHelp")}</p>
              </div>
            )}
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
            requiredErrors={{ fullName: requiredError("name"), phone: requiredError("phone") }}
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
            onReveal={revealFor("payment")}
          />
        )}
        {depositUsesCard(form.depositMethod) && (
          <CardFields
            title={tr("contracts.depositCard")}
            value={form.depositCard}
            disabled={pickupReadOnly}
            onChange={(v) => set("depositCard", v)}
            onReveal={revealFor("deposit")}
          />
        )}
      </Collapsible>

      {/* ── Τύπος & καύσιμα (κλειστή) ── */}
      <Collapsible
        title={tr("contracts.placeAndFuel")}
        summary={[
          form.fuelType ? tr(`fuelType.${form.fuelType}`) : "",
          form.fuelPickup !== null ? `${fuelWord} ${form.fuelPickup}/8` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
        open={!!open.place}
        onToggle={() => toggle("place")}
      >
        <span className="dash-field-label">{tr("contracts.fuelTypeLabel")}</span>
        {/* Χωρίς προεπιλογή: ένα κλικ επιλέγει, κλικ σε άλλο αλλάζει. */}
        <div className="dash-fueltype" role="radiogroup" aria-label={tr("contracts.fuelTypeLabel")}>
          {CONTRACT_FUEL_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={form.fuelType === t}
              disabled={pickupReadOnly}
              className={`dash-fuel-step ${form.fuelType === t ? "current" : ""}`}
              onClick={() => set("fuelType", t)}
            >
              {tr(`fuelType.${t}`)}
            </button>
          ))}
        </div>
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
        count={photos.length + staged.filter((p) => p.target.kind === "damage").length}
        showZero
        open={!!open.damages}
        onToggle={() => toggle("damages")}
      >
        <p className="dash-form-note">{contract ? tr("contracts.photosHelp") : tr("contracts.photosStagedHelp")}</p>
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

      {/* ── Αλλαγή οχήματος (κλειστή) ── */}
      <Collapsible
        title={tr("contracts.vehicleChanges")}
        count={form.vehicleChanges.length}
        open={!!open.changes}
        onToggle={() => toggle("changes")}
      >
        {form.vehicleChanges.length === 0 && <p className="dash-form-note">{tr("contracts.noVehicleChanges")}</p>}
        {form.vehicleChanges.map((c) => (
          <div key={c.id} className="dash-change-row">
            <div className="dash-field">
              {tr("contracts.newVehicle")}
              {/* Ίδιο component με την επιλογή οχήματος· ίδια διαθεσιμότητα με πριν (όλα τα ενεργά). */}
              <VehiclePicker
                vehicles={changeVehicles}
                value={c.vehicleId}
                disabled={changesReadOnly}
                onChange={(id) => setChange(c.id, "vehicleId", id)}
              />
            </div>
            <label className="dash-field">
              {tr("contracts.changeDate")}
              <input
                type="date"
                value={c.date}
                disabled={changesReadOnly}
                onChange={(e) => setChange(c.id, "date", e.target.value)}
              />
            </label>
            {!changesReadOnly && (
              <button className="dash-icon-btn" onClick={() => removeChange(c.id)} aria-label={tr("contracts.removeChange")}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
        {!changesReadOnly && (
          <button className="dash-btn" onClick={addChange}>
            <Plus size={16} /> {tr("contracts.addVehicleChange")}
          </button>
        )}
      </Collapsible>

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

      {/* ── Αποστολή στον πελάτη (Διαχειριστής/Προσωπικό) ── */}
      {contract && can.sendEmail && (
        <section className="dash-panel dash-contract-section">
          <h2 className="dash-section-title">
            <Mail size={17} /> {tr("contracts.emailTitle")}
          </h2>
          <p className="dash-form-note">{tr("contracts.emailNote")}</p>
          <div className="dash-link-actions">
            <button
              type="button"
              className="dash-btn dash-btn--primary"
              disabled={emailBusy || Boolean(emailBlock)}
              title={emailBlock ?? undefined}
              onClick={sendEmail}
            >
              <Mail size={16} />{" "}
              {emailBusy
                ? tr("contracts.emailSending")
                : lastEmail
                  ? tr("contracts.emailResend")
                  : tr("contracts.emailSend")}
            </button>
            <label className="dash-field dash-field--inline">
              <select
                aria-label={tr("contracts.emailLang")}
                value={emailLang}
                disabled={emailBusy}
                onChange={(e) => setEmailLang(e.target.value === "en" ? "en" : "el")}
              >
                <option value="el">{tr("contracts.emailLang_el")}</option>
                <option value="en">{tr("contracts.emailLang_en")}</option>
              </select>
            </label>
          </div>
          {emailBlock && <p className="dash-form-note dash-required-warn">{emailBlock}</p>}
          {lastEmail && (
            <p className="dash-alert-ok">
              {tr("contracts.emailSentTo")} {lastEmail.sentTo} {tr("contracts.emailSentAt")}{" "}
              {new Date(lastEmail.sentAt).toLocaleString(INTL[locale] ?? "el-GR", {
                timeZone: "Europe/Athens",
                dateStyle: "short",
                timeStyle: "short",
              })}
            </p>
          )}
        </section>
      )}

      {error && <div className="dash-form-error">{error}</div>}
      {notice && <div className="dash-alert-ok">{notice}</div>}
      {uploadProgress && (
        <div className="dash-savebar dash-upload-progress" role="status">
          <span>
            {tr("contracts.uploadingPhotos")} {uploadProgress.done}/{uploadProgress.total}
          </span>
        </div>
      )}

      {/* ── Μπάρα αποθήκευσης ── */}
      {isNew ? (
        <div className="dash-savebar">
          {requiredWarned && missingReq.length > 0 ? (
            <span className="dash-required-warn">{tr("contracts.requiredWarn")}</span>
          ) : (
            <span>{tr("contracts.readyToSave")}</span>
          )}
          {draft.hasConflict ? (
            canOverride && (
              <button
                type="button"
                className="dash-btn dash-btn--danger"
                disabled={busy}
                onClick={() => attemptSave(() => create({ override: true }))}
              >
                {busy ? tr("contracts.saving") : tr("bookings.conflictApprove")}
              </button>
            )
          ) : (
            <button
              type="button"
              className="dash-btn dash-btn--primary"
              disabled={busy}
              onClick={() => attemptSave(() => create())}
            >
              <Save size={16} /> {busy ? tr("contracts.saving") : tr("contracts.save")}
            </button>
          )}
        </div>
      ) : (
        !readOnly &&
        dirty && (
          <div className="dash-savebar">
            {requiredWarned && missingReq.length > 0 ? (
              <span className="dash-required-warn">{tr("contracts.requiredWarn")}</span>
            ) : (
              <span>{tr("contracts.unsaved")}</span>
            )}
            <button
              className="dash-btn"
              disabled={busy}
              onClick={() => {
                if (!contract) return;
                setForm(fromContract(contract));
                setReturnSame(contract.returnLocation === contract.pickupLocation);
              }}
            >
              {tr("contracts.discard")}
            </button>
            <button className="dash-btn dash-btn--primary" disabled={busy} onClick={() => attemptSave(() => save())}>
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
  requiredErrors,
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
  /** Μήνυμα ανά υποχρεωτικό πεδίο που λείπει (κόκκινο) — μόνο κύριος οδηγός. */
  requiredErrors?: Partial<Record<"fullName" | "phone", string>>;
}) {
  const tr = useT();
  const locale = useLocale();
  const expiring = licenseExpiresBeforeReturn(d.licenseExpiry, returnDate);
  // Υποχρεωτικά ΜΟΝΟ όνομα και τηλέφωνο του κύριου οδηγού.
  const required = index === 0;
  const requiredOf = (key: string) =>
    key === "fullName" || key === "phone" ? requiredErrors?.[key] : undefined;

  const input = (
    key: "fullName" | "phone" | "email" | "idNumber" | "licenseNumber" | "address" | "country",
    label: string,
    extra: { type?: string; wide?: boolean; req?: boolean; max?: number } = {}
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
        className={requiredOf(key) ? "dash-invalid" : undefined}
        aria-invalid={requiredOf(key) ? true : undefined}
        data-required={key === "fullName" ? "name" : key === "phone" ? "phone" : undefined}
        onChange={(e) => onChange(key, e.target.value)}
        onBlur={onBlurField}
      />
      {requiredOf(key) && <span className="dash-field-error">{requiredOf(key)}</span>}
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
      {/* ΟΛΑ τα πεδία πάντα ορατά· σε κινητό συμπαγές πλέγμα 2 στηλών. */}
      <div className="dash-form-grid dash-driver-grid">
        {input("fullName", tr("contracts.fullName"), { req: required, wide: true })}
        {input("country", tr("contracts.country"), { max: 100 })}
        {input("licenseNumber", tr("contracts.licenseNumber"), { max: 100 })}
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
        {input("phone", tr("contracts.phone"), { type: "tel", req: required, max: 50 })}
        {input("email", tr("contracts.email"), { type: "email", wide: true })}
        {input("address", tr("contracts.address"), { wide: true, max: 500 })}
      </div>
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
  onReveal,
}: {
  title: string;
  value: CardForm;
  disabled: boolean;
  onChange: (v: CardForm) => void;
  /** Μόνο Διαχειριστής με αποθηκευμένο πλήρη αριθμό: φέρνει τον αριθμό από τον server. */
  onReveal?: () => Promise<string | null>;
}) {
  const tr = useT();
  const set = (k: keyof CardForm, v: string) => onChange({ ...value, [k]: v });
  const numberBad = value.number.trim() !== "" && !normalizeCardNumber(value.number);
  // Ο πλήρης αριθμός ζει ΜΟΝΟ στη μνήμη του component όσο είναι «Εμφάνιση».
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  useEffect(() => setRevealed(null), [value.last4]);
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
          {tr("contracts.cardNumber")}
          <input
            inputMode="numeric"
            autoComplete="off"
            maxLength={23}
            // Υπάρχουσα κάρτα: μάσκα με τα 4 τελευταία· κενό πεδίο = μένει ως έχει.
            placeholder={value.last4 ? maskedCardNumber(value.last4) : "1234 5678 9012 3456"}
            value={value.number}
            disabled={disabled}
            // Ψηφία, κενά και παύλες· ο server κρατά μόνο τα ψηφία (13–19).
            onChange={(e) => set("number", e.target.value.replace(/[^\d\s-]/g, "").slice(0, 23))}
          />
          {numberBad && <span className="dash-field-error">{tr("contracts.cardNumberError")}</span>}
          {onReveal && !value.number && (
            <span className="dash-card-reveal">
              <span className="dash-card-full">{revealed ? groupCardNumber(revealed) : maskedCardNumber(value.last4)}</span>
              <button
                type="button"
                className="dash-link-btn"
                disabled={revealing}
                onClick={async () => {
                  if (revealed) return setRevealed(null);
                  setRevealing(true);
                  setRevealed(await onReveal());
                  setRevealing(false);
                }}
              >
                {revealed ? tr("contracts.cardHide") : tr("contracts.cardShow")}
              </button>
            </span>
          )}
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
