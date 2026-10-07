// src/lib/contracts.ts
// Συμβόλαια ενοικίασης — τύποι, σταθερές και καθαρή λογική.
//
// Δεν εισάγει Prisma runtime ώστε να φορτώνεται και σε client component
// (φόρμα, αντίγραφο εκτύπωσης).
//
// Κανόνες:
//  · Ένα συμβόλαιο ανά κράτηση. Κωδικός ΤΥΧΑΙΟΣ, μοναδικός ανά εταιρία.
//  · DRAFT → (υπογράφουν ΟΛΟΙ οι οδηγοί) → SIGNED → COMPLETED.
//  · Το snapshot (εταιρία, κράτηση, όχημα, τιμές, όροι) ανανεώνεται όσο δεν
//    υπάρχει καμία υπογραφή· με την πρώτη υπογραφή παγώνει.
//  · Μετά την υπογραφή όλων κλειδώνουν τα στοιχεία παραλαβής. Αλλάζουν μόνο
//    το καύσιμο παράδοσης, οι αλλαγές οχήματος και οι παρατηρήσεις.

import type { PublicLinkDTO } from "./contractLink";
import type { PriceOverride } from "./priceOverride";

export const CONTRACT_STATUSES = ["DRAFT", "SIGNED", "COMPLETED"] as const;
export type ContractStatusValue = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_CLASS: Record<string, string> = {
  DRAFT: "warn",
  SIGNED: "info",
  COMPLETED: "ok",
};

export const PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER", "OTHER"] as const;
export const DEPOSIT_METHODS = ["CASH", "CARD", "CARD_HOLD"] as const;
export const ID_TYPES = ["ID", "PASSPORT"] as const;
/** Τύποι καυσίμου που προσφέρει το συμβόλαιο (υποσύνολο του enum FuelType). */
export const CONTRACT_FUEL_TYPES = ["PETROL", "DIESEL", "ELECTRIC", "HYBRID"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];
export type IdType = (typeof ID_TYPES)[number];
export type ContractFuelType = (typeof CONTRACT_FUEL_TYPES)[number];

/* ─────────────────────────────────────────────
   Κάρτα — ΜΟΝΟ στοιχεία αναγνώρισης (PCI DSS)
   ───────────────────────────────────────────── */

export const CARD_BRANDS = ["VISA", "MASTERCARD", "OTHER"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

/**
 * Ό,τι αποθηκεύεται για μια κάρτα. ΠΟΤΕ πλήρης αριθμός ή CVV: αυτά
 * περνούν μόνο στο POS.
 */
export interface CardInfo {
  brand: CardBrand;
  /** Ακριβώς 4 ψηφία. */
  last4: string;
  holder: string;
  /** "MM/YY", μήνας 01–12. */
  expiry: string;
}

export const LAST4_RE = /^\d{4}$/;
export const CARD_EXPIRY_RE = /^(0[1-9]|1[0-2])\/\d{2}$/;

export const CARD_BRAND_LABEL: Record<string, string> = {
  VISA: "Visa",
  MASTERCARD: "Mastercard",
  OTHER: "Άλλη / Other",
};

/** Χρειάζεται στοιχεία κάρτας αυτός ο τρόπος; */
export const paymentUsesCard = (m: string | null | undefined) => m === "CARD";
export const depositUsesCard = (m: string | null | undefined) =>
  m === "CARD" || m === "CARD_HOLD";

/** «Visa •••• 1234, λήξη 08/27» — η ΜΟΝΗ μορφή εμφάνισης κάρτας. */
export function cardLine(c: CardInfo | null): string {
  if (!c) return "";
  const brand = c.brand === "OTHER" ? "Κάρτα / Card" : CARD_BRAND_LABEL[c.brand];
  return `${brand} •••• ${c.last4}, λήξη / exp. ${c.expiry}`;
}

/**
 * Αμυντική ανάγνωση από τη βάση: ό,τι δεν ταιριάζει στο σχήμα πετιέται, και
 * κρατάμε ΜΟΝΟ τα 4 γνωστά πεδία — τίποτε άλλο δεν φτάνει ποτέ στον client.
 */
export function readCard(value: unknown): CardInfo | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const last4 = typeof o.last4 === "string" && LAST4_RE.test(o.last4) ? o.last4 : null;
  if (!last4) return null;
  return {
    brand: (CARD_BRANDS as readonly string[]).includes(String(o.brand))
      ? (o.brand as CardBrand)
      : "OTHER",
    last4,
    holder: typeof o.holder === "string" ? o.holder : "",
    expiry: typeof o.expiry === "string" && CARD_EXPIRY_RE.test(o.expiry) ? o.expiry : "",
  };
}

/** Δίγλωσσες ετικέτες του αντιγράφου: «Ελληνικά / English». */
export const BI = {
  contract: "Συμβόλαιο ενοικίασης / Rental agreement",
  code: "Κωδικός / Code",
  booking: "Κράτηση / Booking",
  issuedBy: "Συντάχθηκε από / Issued by",
  status: "Κατάσταση / Status",
  company: "Εταιρία / Company",
  vat: "ΑΦΜ / VAT no.",
  taxOffice: "ΔΟΥ / Tax office",
  phone: "Τηλέφωνο / Phone",
  email: "Email",
  logo: "Λογότυπο / Logo",
  mainDriver: "Κύριος οδηγός / Main driver",
  extraDrivers: "Πρόσθετοι οδηγοί / Additional drivers",
  name: "Ονοματεπώνυμο / Full name",
  country: "Χώρα / Country",
  license: "Δίπλωμα / Licence",
  licenseNo: "Αρ. διπλώματος / Licence no.",
  licenseExpiry: "Λήξη διπλώματος / Licence expiry",
  birthDate: "Ημ. γέννησης / Date of birth",
  idDoc: "Ταυτότητα-Διαβατήριο / ID-Passport",
  address: "Διεύθυνση κατοικίας / Home address",
  pickup: "Παραλαβή / Pick-up",
  return: "Παράδοση / Return",
  location: "Τοποθεσία / Location",
  dateTime: "Ημερομηνία & ώρα / Date & time",
  vehicle: "Όχημα / Vehicle",
  model: "Μοντέλο / Model",
  plate: "Πινακίδα / Plate",
  fuelType: "Καύσιμο / Fuel type",
  fuel: "Καύσιμο / Fuel",
  battery: "Μπαταρία / Battery",
  damages: "Ζημιές στην παραλαβή / Damages at pick-up",
  noDamages: "Χωρίς σημειωμένες ζημιές / No marked damages",
  damagesTitle: "Ζημιές / Damages",
  damagesPickup: "Ζημιές παραλαβής / Damages at pick-up",
  damagesReturn: "Ζημιές παράδοσης / Damages at return",
  oldSketch: "Σκαρίφημα (παλιά καταγραφή) / Sketch (legacy)",
  vehicleChanges: "Αλλαγή οχήματος / Vehicle change",
  date: "Ημερομηνία / Date",
  notes: "Παρατηρήσεις / Remarks",
  charges: "Χρεώσεις / Charges",
  rental: "Ενοίκιο / Rental",
  days: "ημέρες / days",
  extras: "Πρόσθετα / Extras",
  insurance: "Ασφάλεια / Insurance",
  excess: "Απαλλαγή / Excess",
  discount: "Έκπτωση / Discount",
  total: "Τελικό σύνολο (με ΦΠΑ) / Total (VAT incl.)",
  ofWhich: "εκ των οποίων / of which",
  net: "καθαρό / net",
  vatShort: "ΦΠΑ / VAT",
  payment: "Τρόπος πληρωμής / Payment method",
  deposit: "Εγγύηση / Deposit",
  terms: "Όροι ενοικίασης / Terms and conditions",
  gdpr: "Προσωπικά δεδομένα / Personal data (GDPR)",
  signatures: "Υπογραφές / Signatures",
  signedAt: "Υπογράφηκε / Signed",
  notSigned: "Εκκρεμεί υπογραφή / Not signed yet",
  qr: "Το συμβόλαιο online / This agreement online",
} as const;

export const PAYMENT_LABEL: Record<string, string> = {
  CASH: "Μετρητά / Cash",
  CARD: "Κάρτα / Card",
  TRANSFER: "Τραπεζική μεταφορά / Bank transfer",
  OTHER: "Άλλο / Other",
};

export const DEPOSIT_LABEL: Record<string, string> = {
  CASH: "Μετρητά / Cash",
  CARD: "Κάρτα / Card",
  CARD_HOLD: "Δέσμευση κάρτας / Card pre-authorisation",
};

export const ID_TYPE_LABEL: Record<string, string> = {
  ID: "Ταυτότητα / ID card",
  PASSPORT: "Διαβατήριο / Passport",
};

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Πρόχειρο / Draft",
  SIGNED: "Υπογεγραμμένο / Signed",
  COMPLETED: "Ολοκληρωμένο / Completed",
};

export const FUEL_TYPE_LABEL: Record<string, string> = {
  PETROL: "Βενζίνη / Petrol",
  DIESEL: "Πετρέλαιο / Diesel",
  HYBRID: "Υβριδικό / Hybrid",
  ELECTRIC: "Ηλεκτρικό / Electric",
  LPG: "Υγραέριο / LPG",
};

/** Η δήλωση GDPR που τυπώνεται δίπλα στο checkbox — σταθερή, και στις δύο γλώσσες. */
export const GDPR_TEXT = {
  el: "Συναινώ στην επεξεργασία των προσωπικών μου δεδομένων από την εταιρία ενοικίασης αποκλειστικά για την εκτέλεση της σύμβασης και την εκπλήρωση των νόμιμων υποχρεώσεών της, σύμφωνα με τον Κανονισμό (ΕΕ) 2016/679 (GDPR).",
  en: "I consent to the processing of my personal data by the rental company solely for the performance of this agreement and its legal obligations, in accordance with Regulation (EU) 2016/679 (GDPR).",
} as const;

/* ─────────────────────────────────────────────
   Οδηγοί
   ───────────────────────────────────────────── */

export interface ContractDriver {
  id: string;
  fullName: string;
  country: string;
  licenseNumber: string;
  /** "YYYY-MM-DD" ή "" */
  licenseExpiry: string;
  /** "YYYY-MM-DD" ή "" */
  birthDate: string;
  idType: IdType;
  idNumber: string;
  phone: string;
  email: string;
  address: string;
  /** data:image/png;base64,… ή null */
  signature: string | null;
  /** ISO ή null */
  signedAt: string | null;
  /**
   * Φωτογραφίες διπλώματος: ΔΙΑΔΡΟΜΕΣ στο Storage. Μόνο στον server — το
   * toContractDTO τις αφαιρεί· η φόρμα παίρνει signed URLs (licensePhotos
   * του DTO). Ποτέ στο Α4, στη σελίδα πελάτη ή στο searchText.
   */
  licensePhotos?: LicensePhotoPaths;
}

/* ─────────────────────────────────────────────
   Φωτογραφίες διπλώματος
   ───────────────────────────────────────────── */

/** Όριο φωτογραφιών διπλώματος ανά οδηγό (μπροστά, πίσω, δεύτερη λήψη…). */
export const MAX_LICENSE_PHOTOS = 4;

/**
 * Διαδρομές στο Storage, με τη σειρά λήψης. Νέα μορφή: πίνακας. Η παλιά
 * μορφή `{ front, back }` διαβάζεται και γίνεται `[front, back]` (πρώτες
 * στη λίστα) — μετατροπή ΚΑΤΑ ΤΗΝ ΑΝΑΓΝΩΣΗ, χωρίς μαζική αλλαγή στη βάση.
 * Η επόμενη εγγραφή του οδηγού την αποθηκεύει ως πίνακα.
 */
export type LicensePhotoPaths = string[];

/** Μία φωτογραφία διπλώματος όπως τη βλέπει η φόρμα (ποτέ διαδρομή). */
export interface LicensePhotoDTO {
  driverId: string;
  id: string;
  url: string | null;
}

/**
 * Ο ΙΔΙΟΣ κανόνας για UI και server. Ανέβασμα: μέχρι την ολοκλήρωση (και
 * μετά τις υπογραφές — είναι αποδεικτικό). Διαγραφή: μόνο πριν την πρώτη
 * υπογραφή.
 */
export function licenseLockOf(
  action: "upload" | "delete",
  status: string,
  drivers: ContractDriver[]
): "signed" | "completed" | null {
  if (status === "COMPLETED") return "completed";
  if (action === "delete" && (status !== "DRAFT" || anySigned(drivers))) return "signed";
  return null;
}

/** Παλιά `{ front, back }` ή νέα `[…]` → πίνακας διαδρομών (κενός = undefined). */
export function readLicensePhotos(v: unknown): LicensePhotoPaths | undefined {
  let out: string[] = [];
  if (Array.isArray(v)) {
    out = v.filter((p): p is string => typeof p === "string" && p !== "");
  } else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    out = [o.front, o.back].filter((p): p is string => typeof p === "string" && p !== "");
  }
  out = Array.from(new Set(out));
  return out.length ? out : undefined;
}

/** Όλες οι διαδρομές διπλωμάτων των οδηγών (για signed URLs / διαγραφή). */
export const licensePathsOf = (drivers: ContractDriver[]): string[] =>
  drivers.flatMap((d) => d.licensePhotos ?? []);

export const emptyDriver = (id: string): ContractDriver => ({
  id,
  fullName: "",
  country: "",
  licenseNumber: "",
  licenseExpiry: "",
  birthDate: "",
  idType: "ID",
  idNumber: "",
  phone: "",
  email: "",
  address: "",
  signature: null,
  signedAt: null,
});

/** Τα πεδία που επεξεργάζεται ο χρήστης — όχι υπογραφή/ημερομηνία. */
export const DRIVER_FIELDS = [
  "fullName",
  "country",
  "licenseNumber",
  "licenseExpiry",
  "birthDate",
  "idType",
  "idNumber",
  "phone",
  "email",
  "address",
] as const;

/** Το δίπλωμα λήγει πριν (ή την ημέρα) της επιστροφής; */
export function licenseExpiresBeforeReturn(
  licenseExpiry: string,
  returnDate: string
): boolean {
  if (!licenseExpiry || !returnDate) return false;
  return licenseExpiry < returnDate;
}

/* ─────────────────────────────────────────────
   Σκαρίφημα, αλλαγές οχήματος
   ───────────────────────────────────────────── */

export interface DamageMark {
  id: string;
  /** Θέση σε % του πλάτους / ύψους του σχεδίου, 0–100. */
  x: number;
  y: number;
  note: string;
}

export interface VehicleChange {
  id: string;
  vehicleId: string;
  /** "Μάρκα Μοντέλο" από τον Στόλο τη στιγμή της αλλαγής. */
  label: string;
  plate: string;
  /** "YYYY-MM-DD" */
  date: string;
}

/* ─────────────────────────────────────────────
   Καύσιμο σε όγδοα
   ───────────────────────────────────────────── */

export const FUEL_STEPS = 8;
export const fuelPercent = (eighths: number) => Math.round((eighths / FUEL_STEPS) * 100);
export const fuelLabel = (eighths: number | null) =>
  eighths === null ? "—" : `${eighths}/8 · ${fuelPercent(eighths)}%`;

/* ─────────────────────────────────────────────
   Snapshot
   ───────────────────────────────────────────── */

export interface ContractSnapshot {
  company: {
    name: string;
    region: string;
    vat: string;
    taxOffice: string;
    phone: string;
    email: string;
    address: string;
    logoUrl: string | null;
  };
  booking: {
    number: string;
    pickupDate: string;
    pickupTime: string | null;
    returnDate: string;
    returnTime: string | null;
    totalDays: number;
    dailyRate: number;
    subtotal: number;
    extrasTotal: number;
    insuranceCost: number;
    discountAmount: number;
    discountCode: string | null;
    total: number;
  };
  vehicle: {
    id: string;
    brand: string;
    model: string;
    plate: string;
    fuel: string;
  };
  extras: { name: string; lineTotal: number }[];
  insurance: { name: string; lineTotal: number; excess: number | null }[];
  terms: { el: string; en: string };
  /** ΦΠΑ % της εταιρίας τη στιγμή του snapshot (οι τιμές το ΠΕΡΙΕΧΟΥΝ). */
  vatRate?: number;
  /**
   * Χειροκίνητη τελική τιμή (contracts.price). Όταν υπάρχει, το
   * booking.total ΕΙΝΑΙ αυτή η τιμή· οι γραμμές μένουν υπολογισμένες.
   * Ποιος/πότε/γιατί ΜΟΝΟ στη φόρμα — η σελίδα πελάτη παίρνει μόνο το ποσό.
   */
  priceOverride?: PriceOverride;
  /** ISO — πότε πάρθηκε. */
  takenAt: string;
}

/** Αμυντική ανάγνωση του Json της βάσης: παλιά/κενά snapshot γίνονται null. */
export function readSnapshot(value: unknown): ContractSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Partial<ContractSnapshot>;
  if (!s.company || !s.booking || !s.vehicle) return null;
  return {
    company: s.company,
    booking: s.booking,
    vehicle: s.vehicle,
    extras: Array.isArray(s.extras) ? s.extras : [],
    insurance: Array.isArray(s.insurance) ? s.insurance : [],
    terms: s.terms ?? { el: "", en: "" },
    vatRate: typeof s.vatRate === "number" ? s.vatRate : undefined,
    priceOverride:
      s.priceOverride && typeof s.priceOverride === "object" && Number(s.priceOverride.manualTotal) > 0
        ? s.priceOverride
        : undefined,
    takenAt: s.takenAt ?? "",
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function readDrivers(value: unknown): ContractDriver[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== "string") return [];
    const lp = readLicensePhotos(o.licensePhotos);
    return [
      {
        id: o.id,
        fullName: str(o.fullName),
        country: str(o.country),
        licenseNumber: str(o.licenseNumber),
        licenseExpiry: str(o.licenseExpiry),
        birthDate: str(o.birthDate),
        idType: o.idType === "PASSPORT" ? "PASSPORT" : "ID",
        idNumber: str(o.idNumber),
        phone: str(o.phone),
        email: str(o.email),
        address: str(o.address),
        signature: typeof o.signature === "string" ? o.signature : null,
        signedAt: typeof o.signedAt === "string" ? o.signedAt : null,
        ...(lp ? { licensePhotos: lp } : {}),
      },
    ];
  });
}

export function readMarks(value: unknown): DamageMark[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== "string") return [];
    return [
      {
        id: o.id,
        x: Number(o.x) || 0,
        y: Number(o.y) || 0,
        note: str(o.note),
      },
    ];
  });
}

export function readChanges(value: unknown): VehicleChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== "string") return [];
    return [
      {
        id: o.id,
        vehicleId: str(o.vehicleId),
        label: str(o.label),
        plate: str(o.plate),
        date: str(o.date),
      },
    ];
  });
}

/* ─────────────────────────────────────────────
   DTO
   ───────────────────────────────────────────── */

export interface ContractDTO {
  id: string;
  contractNumber: string;
  status: ContractStatusValue;
  bookingId: string;
  bookingNumber: string;
  bookingStatus: string;
  createdByName: string | null;
  snapshot: ContractSnapshot | null;
  drivers: ContractDriver[];
  pickupLocation: string;
  returnLocation: string;
  /** Τύπος καυσίμου του συμβολαίου· null = δεν επιλέχθηκε. */
  fuelType: ContractFuelType | null;
  fuelPickup: number | null;
  /** ΠΑΛΙΟ — μόνο ανάγνωση σε παλιά συμβόλαια. */
  fuelReturn: number | null;
  /** ΠΑΛΙΟ σκαρίφημα — μόνο ανάγνωση. */
  damageMarks: DamageMark[];
  /** Τα URLs υπάρχουν μόνο όταν φορτώνει σελίδα (loadContract)· αλλιώς null. */
  damagePhotos: ContractPhotoDTO[];
  damageNotesPickup: string;
  damageNotesReturn: string;
  vehicleChanges: VehicleChange[];
  notes: string;
  paymentMethod: PaymentMethod | null;
  depositAmount: number | null;
  depositMethod: DepositMethod | null;
  paymentCard: CardInfo | null;
  depositCard: CardInfo | null;
  gdprConsent: boolean;
  signedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;

  /* ── Η κράτηση ΤΩΡΑ (όχι το snapshot) ── */
  /** Τα πρόσθετα που έχει η κράτηση αυτή τη στιγμή. */
  bookingExtraIds: string[];
  /** Το σημερινό σύνολο της κράτησης — για την προειδοποίηση αλλαγής. */
  bookingTotalNow: number;
  /** Γιατί δεν αλλάζουν τα πρόσθετα· null όταν αλλάζουν. */
  extrasLock: ExtrasLock | null;

  /** Διπλώματα — ΜΟΝΟ για τη φόρμα· URLs μόνο στο loadContract. */
  licensePhotos: LicensePhotoDTO[];
  /** Link πελάτη (/c/[token]). */
  publicLink: PublicLinkDTO;
}

/**
 * signed    — έχει ήδη υπογράψει κάποιος (το σύνολο είναι μέρος του εγγράφου)
 * invoiced  — η κράτηση έχει εκδομένο τιμολόγιο (δεν αλλάζει ποτέ)
 * closed    — η κράτηση είναι ολοκληρωμένη ή ακυρωμένη
 */
export type ExtrasLock = "signed" | "invoiced" | "closed";

/** Γραμμή λίστας — χωρίς υπογραφές και snapshot (βαριά πεδία). */
export interface ContractListItem {
  id: string;
  contractNumber: string;
  status: ContractStatusValue;
  bookingId: string;
  bookingNumber: string;
  customerName: string;
  vehicleLabel: string;
  pickupDate: string;
  returnDate: string;
  drivers: number;
  signedDrivers: number;
  createdByName: string | null;
  createdAt: string;
}

/** Όλοι οι οδηγοί υπέγραψαν; (Χωρίς οδηγούς → όχι.) */
export const allSigned = (drivers: ContractDriver[]) =>
  drivers.length > 0 && drivers.every((d) => Boolean(d.signature));

export const anySigned = (drivers: ContractDriver[]) =>
  drivers.some((d) => Boolean(d.signature));

/* ─────────────────────────────────────────────
   Κωδικός
   ───────────────────────────────────────────── */

/** Χωρίς 0/O, 1/I/L — ώστε να διαβάζεται και να υπαγορεύεται χωρίς λάθη. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** C-XXXXXX με κρυπτογραφικά τυχαίους χαρακτήρες. */
export function randomContractCode(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `C-${out}`;
}

/** Τυχαίο id για οδηγό / σημάδι / αλλαγή μέσα στο Json. */
export function randomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ─────────────────────────────────────────────
   Αναζήτηση — ΜΙΑ κανονικοποίηση για αποθήκευση ΚΑΙ ερώτημα
   ───────────────────────────────────────────── */

/**
 * Ελληνικά γράμματα που μοιάζουν με λατινικά (όπως στις πινακίδες)
 * γίνονται λατινικά, ώστε «ΙΚΑ 1234» = «ika1234». Εφαρμόζεται ΙΔΙΑ στο
 * κείμενο και στο ερώτημα, άρα δεν χαλά καμία άλλη αναζήτηση.
 */
const LOOKALIKE: Record<string, string> = {
  α: "a", β: "b", ε: "e", ζ: "z", η: "h", ι: "i", κ: "k", μ: "m",
  ν: "n", ο: "o", ρ: "p", τ: "t", υ: "y", χ: "x", ς: "σ",
};

/**
 * Πεζά, χωρίς τόνους/διαλυτικά, χωρίς κενά, παύλες, τελείες ή άλλα σύμβολα.
 * Κρατά μόνο γράμματα (κάθε αλφαβήτου) και ψηφία.
 */
export function normalizeSearch(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .replace(/./g, (ch) => LOOKALIKE[ch] ?? ch);
}

const MONTHS_EL = [
  "Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος",
  "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος",
];
/** Γενική πτώση: «25 Δεκεμβρίου 2026». */
const MONTHS_EL_GEN = [
  "Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου",
  "Ιουλίου", "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου",
];
const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Όλες οι μορφές μιας ημερομηνίας "YYYY-MM-DD" για το κείμενο αναζήτησης:
 * ISO, ημέρα/μήνας/έτος και όνομα μήνα ΕΛ/EN (ονομαστική και γενική).
 */
export function dateSearchForms(iso: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return [];
  const [, y, mm, dd] = m;
  const mi = Number(mm) - 1;
  if (mi < 0 || mi > 11) return [];
  return [
    `${y}-${mm}-${dd}`,
    `${dd}/${mm}/${y}`,
    `${MONTHS_EL[mi]} ${y}`,
    `${Number(dd)} ${MONTHS_EL_GEN[mi]} ${y}`,
    `${MONTHS_EN[mi]} ${y}`,
  ];
}

/** Τηλέφωνο και χωρίς κωδικό χώρας (+30 / 0030), ώστε να βρίσκεται με όλους τους τρόπους. */
export function phoneSearchForms(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return [];
  const local = digits.replace(/^(00)?30(?=\d{10}$)/, "");
  return local !== digits ? [digits, local] : [digits];
}

/** Το κείμενο αναζήτησης: κάθε τιμή κανονικοποιείται χωριστά, ενώνονται με κενό. */
export function buildSearchText(values: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    const n = normalizeSearch(v);
    if (n) seen.add(n);
  }
  return Array.from(seen).join(" ");
}

/**
 * Το ερώτημα του χρήστη → λέξεις-κλειδιά (όλες πρέπει να ταιριάζουν).
 * Ημερομηνίες γίνονται στη μορφή που είναι αποθηκευμένες· τηλέφωνα με
 * +30 χάνουν τον κωδικό χώρας.
 */
export function searchTokens(query: string): string[] {
  const out: string[] = [];
  for (const raw of query.trim().split(/\s+/).filter(Boolean).slice(0, 8)) {
    // 25/12/2026 · 5-1-2026 · 25.12.2026
    const dmy = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(raw);
    // 2026-12-25 · 2026/12/25
    const ymd = /^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/.exec(raw);
    let token: string;
    if (dmy) {
      token = `${dmy[1].padStart(2, "0")}${dmy[2].padStart(2, "0")}${dmy[3]}`;
    } else if (ymd) {
      token = `${ymd[1]}${ymd[2].padStart(2, "0")}${ymd[3].padStart(2, "0")}`;
    } else {
      token = normalizeSearch(raw);
      if (/^\d+$/.test(token)) token = token.replace(/^(00)?30(?=\d{10}$)/, "");
    }
    if (token) out.push(token);
  }
  return Array.from(new Set(out));
}

/* ─────────────────────────────────────────────
   Φωτογραφίες ζημιών
   ───────────────────────────────────────────── */

export const PHOTO_GROUPS = ["PICKUP", "RETURN"] as const;
export type PhotoGroup = (typeof PHOTO_GROUPS)[number];

/** Όπως αποθηκεύεται στο contracts."damagePhotos". */
export interface ContractPhoto {
  id: string;
  path: string;
  group: PhotoGroup;
  takenAt: string | null;
  note: string;
}

export interface ContractPhotoDTO {
  id: string;
  group: PhotoGroup;
  url: string | null;
  takenAt: string | null;
  note: string;
}

export function readPhotos(value: unknown): ContractPhoto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.path !== "string") return [];
    const group = o.group === "RETURN" ? "RETURN" : "PICKUP";
    return [
      {
        id: o.id,
        path: o.path,
        group,
        takenAt: typeof o.takenAt === "string" ? o.takenAt : null,
        note: typeof o.note === "string" ? o.note : "",
      } satisfies ContractPhoto,
    ];
  });
}

/**
 * Γιατί δεν αλλάζουν οι φωτογραφίες μιας ομάδας — ο ΙΔΙΟΣ κανόνας για UI
 * και server. Παραλαβή: μόνο πριν την πρώτη υπογραφή. Παράδοση: μέχρι την
 * ολοκλήρωση.
 */
export function photoLockOf(
  group: PhotoGroup,
  status: string,
  drivers: ContractDriver[]
): "signed" | "completed" | null {
  if (status === "COMPLETED") return "completed";
  if (group === "PICKUP" && (status !== "DRAFT" || anySigned(drivers))) return "signed";
  return null;
}
