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

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];
export type IdType = (typeof ID_TYPES)[number];

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
  total: "Σύνολο (με ΦΠΑ) / Total (VAT incl.)",
  payment: "Τρόπος πληρωμής / Payment method",
  deposit: "Εγγύηση / Deposit",
  terms: "Όροι ενοικίασης / Terms and conditions",
  gdpr: "Προσωπικά δεδομένα / Personal data (GDPR)",
  signatures: "Υπογραφές / Signatures",
  signedAt: "Υπογράφηκε / Signed",
  notSigned: "Εκκρεμεί υπογραφή / Not signed yet",
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
}

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
  fuelPickup: number | null;
  fuelReturn: number | null;
  damageMarks: DamageMark[];
  vehicleChanges: VehicleChange[];
  notes: string;
  paymentMethod: PaymentMethod | null;
  depositAmount: number | null;
  depositMethod: DepositMethod | null;
  gdprConsent: boolean;
  signedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

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
