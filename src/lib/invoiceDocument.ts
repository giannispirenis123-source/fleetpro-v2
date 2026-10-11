// src/lib/invoiceDocument.ts
// Το περιεχόμενο του PDF τιμολογίου — καθαρή λογική, ΧΩΡΙΣ runtime imports
// βάσης/δικτύου, ώστε να το φορτώνουν ο server και τα tests.
//
//  · Τα ποσά καθαρό/ΦΠΑ/σύνολο είναι ΠΑΝΤΑ τα ΑΠΟΘΗΚΕΥΜΕΝΑ του τιμολογίου
//    (subtotal, taxAmount, total) — δεν ξαναϋπολογίζονται.
//  · Οι γραμμές (ενοίκιο, πρόσθετα, ασφάλεια, έκπτωση) είναι ανάλυση της
//    κράτησης, με ΦΠΑ, με τον ίδιο τρόπο που τη δείχνει το συμβόλαιο. Αν δεν
//    αθροίζουν ακριβώς στο σύνολο του τιμολογίου (π.χ. άλλαξε η κράτηση μετά
//    την έκδοση), μπαίνει μία γραμμή «Υπηρεσίες ενοικίασης» με το σύνολο —
//    ποτέ πίνακας που δεν συμφωνεί με το παραστατικό.
//  · Ποσά πάντα σε ελληνική μορφή (1.234,56 €), και στα αγγλικά.

import { round2, toDisplayBreakdown, type PricedExtraLine } from "./pricing";
import { withManualRental } from "./priceOverride";

export const DOC_LANGS = ["el", "en"] as const;
export type DocLang = (typeof DOC_LANGS)[number];

/** «el» εκτός αν ζητήθηκε ρητά «en». */
export const parseDocLang = (v: unknown): DocLang | null =>
  v === null || v === undefined || v === "" ? "el" : v === "el" || v === "en" ? v : null;

/* ─────────────────────────────────────────────
   Μορφοποίηση
   ───────────────────────────────────────────── */

/** 1234.5 → «1.234,50 €» (ελληνικό πρότυπο, ανεξάρτητα από τη γλώσσα). */
export function eurEl(n: number): string {
  const v = round2(n);
  const [int, dec] = Math.abs(v).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${v < 0 ? "−" : ""}${grouped},${dec} €`;
}

/** "YYYY-MM-DD…" → «dd/mm/yyyy». */
export function dmy(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "—";
}

/** Ποσοστό ΦΠΑ χωρίς περιττά δεκαδικά: 24 → «24», 13.5 → «13,5». */
export const pct = (n: number) => String(round2(n)).replace(".", ",");

/* ─────────────────────────────────────────────
   Ετικέτες του PDF — ΔΙΓΛΩΣΣΕΣ, σε ΕΝΑ σημείο
   ───────────────────────────────────────────── */

/** Μία ετικέτα και στις δύο γλώσσες: τα ελληνικά τυπώνονται πρώτα, τα αγγλικά από κάτω. */
export interface BiLabel {
  el: string;
  en: string;
}

/**
 * ΟΛΕΣ οι σταθερές ετικέτες του PDF τιμολογίου. Το PDF είναι ΠΑΝΤΑ δίγλωσσο·
 * για να αλλάξει ένα κείμενο, αλλάζει μόνο εδώ. (Το κείμενο του email ζει
 * χωριστά, στο invoiceEmail.ts, και είναι σε μία γλώσσα.)
 */
export const INVOICE_LABELS = {
  title: { el: "ΤΙΜΟΛΟΓΙΟ", en: "INVOICE" },
  docTitle: { el: "Τιμολόγιο", en: "Invoice" },
  code: { el: "Κωδικός τιμολογίου", en: "Invoice code" },
  issueDate: { el: "Ημερομηνία έκδοσης", en: "Issue date" },
  dueDate: { el: "Ημερομηνία λήξης", en: "Due date" },
  status: { el: "Κατάσταση", en: "Status" },
  company: { el: "Στοιχεία εταιρείας", en: "Company details" },
  customer: { el: "Στοιχεία πελάτη", en: "Customer details" },
  vat: { el: "ΑΦΜ", en: "VAT no." },
  taxOffice: { el: "ΔΟΥ", en: "Tax office" },
  address: { el: "Διεύθυνση", en: "Address" },
  phone: { el: "Τηλέφωνο", en: "Phone" },
  email: { el: "Email", en: "Email" },
  iban: { el: "IBAN", en: "IBAN" },
  booking: { el: "Αναφορά κράτησης", en: "Booking reference" },
  bookingNo: { el: "Κράτηση", en: "Booking" },
  vehicle: { el: "Όχημα", en: "Vehicle" },
  plate: { el: "Πινακίδα", en: "Plate" },
  pickup: { el: "Παραλαβή", en: "Pick-up" },
  return: { el: "Επιστροφή", en: "Return" },
  description: { el: "Περιγραφή", en: "Description" },
  amount: { el: "Ποσό (με ΦΠΑ)", en: "Amount (incl. VAT)" },
  rental: { el: "Ενοίκιο οχήματος", en: "Vehicle rental" },
  day: { el: "ημέρα", en: "day" },
  days: { el: "ημέρες", en: "days" },
  extra: { el: "Πρόσθετο", en: "Extra" },
  extras: { el: "Πρόσθετα", en: "Extras" },
  insurance: { el: "Ασφάλεια", en: "Insurance" },
  discount: { el: "Έκπτωση", en: "Discount" },
  services: { el: "Υπηρεσίες ενοικίασης οχήματος", en: "Vehicle rental services" },
  net: { el: "Καθαρό ποσό", en: "Net amount" },
  vatLine: { el: "ΦΠΑ", en: "VAT" },
  total: { el: "Σύνολο", en: "Total" },
  paidAt: { el: "Εξοφλήθηκε", en: "Paid on" },
  payment: { el: "Τρόπος πληρωμής", en: "Payment" },
  paymentIban: { el: "Τραπεζική μεταφορά στο IBAN", en: "Bank transfer to IBAN" },
  paymentRef: {
    el: "Παρακαλούμε αναφέρετε τον κωδικό τιμολογίου στην αιτιολογία.",
    en: "Please quote the invoice code as the payment reference.",
  },
  vatNote: { el: "Οι τιμές των γραμμών περιλαμβάνουν ΦΠΑ.", en: "Line amounts include VAT." },
  issuedBy: { el: "Εκδόθηκε ηλεκτρονικά με το FleetPro.", en: "Issued electronically with FleetPro." },
  status_PAID: { el: "Πληρωμένο", en: "Paid" },
  status_UNPAID: { el: "Απλήρωτο", en: "Unpaid" },
  status_OVERDUE: { el: "Ληξιπρόθεσμο", en: "Overdue" },
  status_CANCELLED: { el: "Ακυρωμένο", en: "Cancelled" },
} as const satisfies Record<string, BiLabel>;

export type InvoiceLabelKey = keyof typeof INVOICE_LABELS;

export const L: Record<InvoiceLabelKey, BiLabel> = INVOICE_LABELS;

/** Η κατάσταση και στις δύο γλώσσες (άγνωστη → ο κωδικός ως έχει). */
export const statusLabel = (status: string): BiLabel =>
  (INVOICE_LABELS as Record<string, BiLabel>)[`status_${status}`] ?? { el: status, en: status };

/** «ΦΠΑ 24%» / «VAT 24%». */
export const vatLabel = (rate: number): BiLabel => ({
  el: `${L.vatLine.el} ${pct(rate)}%`,
  en: `${L.vatLine.en} ${pct(rate)}%`,
});

/* ─────────────────────────────────────────────
   Δεδομένα του εγγράφου
   ───────────────────────────────────────────── */

export type InvoiceLineKind = "rental" | "extra" | "extras" | "insurance" | "discount" | "services";

export interface InvoiceLine {
  kind: InvoiceLineKind;
  /** Όνομα πρόσθετου/ασφάλειας ή κωδικός έκπτωσης. */
  name?: string;
  /** Μόνο στο ενοίκιο. */
  days?: number;
  /** Μόνο στο ενοίκιο, όταν ΔΕΝ είναι χειροκίνητο. */
  dailyRate?: number;
  /** Με ΦΠΑ. Η έκπτωση είναι αρνητική. */
  amount: number;
}

export interface InvoiceDoc {
  code: string;
  issueDate: string;
  dueDate: string;
  paidAt: string | null;
  /** Η «πραγματική» κατάσταση (effectiveStatus): UNPAID μετά τη λήξη → OVERDUE. */
  status: string;
  company: {
    name: string;
    vat: string | null;
    taxOffice: string | null;
    address: string | null;
    region: string | null;
    phone: string | null;
    email: string | null;
    iban: string | null;
    brandColor: string | null;
  };
  customer: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  booking: {
    number: string;
    vehicle: string;
    plate: string;
    pickupDate: string;
    pickupTime: string | null;
    returnDate: string;
    returnTime: string | null;
  } | null;
  lines: InvoiceLine[];
  /** ΑΠΟΘΗΚΕΥΜΕΝΑ ποσά του τιμολογίου. */
  net: number;
  vatRate: number;
  vatAmount: number;
  total: number;
}

export interface BookingMoney {
  totalDays: number;
  dailyRate: number;
  subtotal: number;
  extrasTotal: number;
  insuranceCost: number;
  discountAmount: number;
  discountCode: string | null;
  total: number;
  extras: PricedExtraLine[];
}

const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

/**
 * Οι γραμμές του πίνακα. `manualRental` = χειροκίνητο ενοίκιο του
 * συμβολαίου (αν υπάρχει) — ίδιο με το Α4/PDF του συμβολαίου.
 */
export function invoiceLines(
  b: BookingMoney | null,
  invoiceTotal: number,
  manualRental?: number
): InvoiceLine[] {
  const fallback: InvoiceLine[] = [{ kind: "services", amount: round2(invoiceTotal) }];
  if (!b) return fallback;

  const money =
    manualRental !== undefined ? withManualRental(b, manualRental) : toDisplayBreakdown(b);

  const lines: InvoiceLine[] = [
    {
      kind: "rental",
      days: b.totalDays,
      ...(manualRental === undefined && b.dailyRate > 0 ? { dailyRate: b.dailyRate } : {}),
      amount: round2(money.subtotal),
    },
  ];

  // Ανά πρόσθετο/ασφάλεια όταν το snapshot συμφωνεί με το σύνολο της
  // κατηγορίας· αλλιώς μία συγκεντρωτική γραμμή.
  const group = (type: "EXTRA" | "INSURANCE", total: number) => {
    if (round2(total) === 0) return;
    const items = b.extras.filter((x) => (x.type === "INSURANCE" ? "INSURANCE" : "EXTRA") === type);
    if (items.length > 0 && sum(items.map((x) => x.lineTotal)) === round2(total)) {
      for (const x of items) {
        lines.push({ kind: type === "EXTRA" ? "extra" : "insurance", name: x.name, amount: round2(x.lineTotal) });
      }
    } else {
      lines.push({ kind: type === "EXTRA" ? "extras" : "insurance", amount: round2(total) });
    }
  };
  group("EXTRA", money.extrasTotal);
  group("INSURANCE", money.insuranceCost);

  if (money.discountAmount > 0) {
    lines.push({
      kind: "discount",
      ...(b.discountCode ? { name: b.discountCode } : {}),
      amount: -round2(money.discountAmount),
    });
  }

  // Ο πίνακας πρέπει να συμφωνεί με το ΑΠΟΘΗΚΕΥΜΕΝΟ σύνολο.
  return sum(lines.map((l) => l.amount)) === round2(invoiceTotal) ? lines : fallback;
}

/**
 * Η περιγραφή μιας γραμμής και στις δύο γλώσσες. Οι ΤΙΜΕΣ (όνομα πρόσθετου,
 * κωδικός έκπτωσης, ημέρες, τιμή) γράφονται μία φορά, στην ελληνική γραμμή·
 * η αγγλική είναι η ετικέτα, για να διαβάζεται από το εξωτερικό.
 */
export function lineLabel(line: InvoiceLine): BiLabel {
  const bi = (k: InvoiceLabelKey, valueEl = "", valueEn = ""): BiLabel => ({
    el: `${L[k].el}${valueEl}`,
    en: `${L[k].en}${valueEn}`,
  });
  switch (line.kind) {
    case "rental": {
      const days = line.days ?? 0;
      const unit = days === 1 ? L.day : L.days;
      const rate = line.dailyRate !== undefined && days > 0 ? ` × ${eurEl(line.dailyRate)}` : "";
      return days > 0
        ? bi("rental", ` · ${days} ${unit.el}${rate}`, ` · ${days} ${unit.en}`)
        : bi("rental");
    }
    case "extra":
      return line.name ? bi("extra", `: ${line.name}`) : bi("extra");
    case "extras":
      return bi("extras");
    case "insurance":
      return line.name ? bi("insurance", `: ${line.name}`) : bi("insurance");
    case "discount":
      return line.name ? bi("discount", ` (${line.name})`) : bi("discount");
    case "services":
      return bi("services");
  }
}

/** Όνομα αρχείου: Invoice-<κωδικός>.pdf, μόνο ασφαλείς χαρακτήρες. */
export const invoicePdfFilename = (code: string) =>
  `Invoice-${code.replace(/[^A-Za-z0-9_-]/g, "") || "copy"}.pdf`;

/** «#2563EB» → [0..1]×3· άκυρο → null. */
export function parseHexColor(hex: string | null | undefined): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec((hex ?? "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}
