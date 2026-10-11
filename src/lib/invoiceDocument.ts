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
   Ετικέτες
   ───────────────────────────────────────────── */

export const INVOICE_LABELS = {
  el: {
    title: "ΤΙΜΟΛΟΓΙΟ",
    docTitle: "Τιμολόγιο",
    code: "Κωδικός τιμολογίου",
    issueDate: "Ημερομηνία έκδοσης",
    dueDate: "Ημερομηνία λήξης",
    status: "Κατάσταση",
    issuer: "Εκδότης",
    customer: "Πελάτης",
    vat: "ΑΦΜ",
    taxOffice: "ΔΟΥ",
    phone: "Τηλ.",
    email: "Email",
    iban: "IBAN",
    booking: "Στοιχεία κράτησης",
    bookingNo: "Κράτηση",
    vehicle: "Όχημα",
    plate: "Πινακίδα",
    pickup: "Παραλαβή",
    return: "Επιστροφή",
    description: "Περιγραφή",
    amount: "Ποσό (με ΦΠΑ)",
    rental: "Ενοίκιο οχήματος",
    day: "ημέρα",
    days: "ημέρες",
    extra: "Πρόσθετο",
    extras: "Πρόσθετα",
    insurance: "Ασφάλεια",
    discount: "Έκπτωση",
    services: "Υπηρεσίες ενοικίασης οχήματος",
    net: "Καθαρό ποσό",
    vatLine: "ΦΠΑ",
    total: "Σύνολο",
    paidAt: "Εξοφλήθηκε",
    payment: "Τρόπος πληρωμής",
    paymentIban: "Τραπεζική μεταφορά στο IBAN",
    paymentRef: "Παρακαλούμε αναφέρετε τον κωδικό τιμολογίου στην αιτιολογία.",
    vatNote: "Οι τιμές των γραμμών περιλαμβάνουν ΦΠΑ.",
    issuedBy: "Εκδόθηκε ηλεκτρονικά με το FleetPro.",
    status_PAID: "Πληρωμένο",
    status_UNPAID: "Απλήρωτο",
    status_OVERDUE: "Ληξιπρόθεσμο",
    status_CANCELLED: "Ακυρωμένο",
  },
  en: {
    title: "INVOICE",
    docTitle: "Invoice",
    code: "Invoice code",
    issueDate: "Issue date",
    dueDate: "Due date",
    status: "Status",
    issuer: "From",
    customer: "Bill to",
    vat: "VAT No.",
    taxOffice: "Tax office",
    phone: "Tel.",
    email: "Email",
    iban: "IBAN",
    booking: "Booking details",
    bookingNo: "Booking",
    vehicle: "Vehicle",
    plate: "Plate",
    pickup: "Pick-up",
    return: "Return",
    description: "Description",
    amount: "Amount (incl. VAT)",
    rental: "Vehicle rental",
    day: "day",
    days: "days",
    extra: "Extra",
    extras: "Extras",
    insurance: "Insurance",
    discount: "Discount",
    services: "Vehicle rental services",
    net: "Net amount",
    vatLine: "VAT",
    total: "Total",
    paidAt: "Paid on",
    payment: "Payment",
    paymentIban: "Bank transfer to IBAN",
    paymentRef: "Please quote the invoice code as the payment reference.",
    vatNote: "Line amounts include VAT.",
    issuedBy: "Issued electronically with FleetPro.",
    status_PAID: "Paid",
    status_UNPAID: "Unpaid",
    status_OVERDUE: "Overdue",
    status_CANCELLED: "Cancelled",
  },
} as const;

export type InvoiceLabels = { [K in keyof (typeof INVOICE_LABELS)["el"]]: string };

export const invoiceLabels = (lang: DocLang): InvoiceLabels => INVOICE_LABELS[lang];

export const statusLabel = (status: string, lang: DocLang): string => {
  const l = invoiceLabels(lang) as Record<string, string>;
  return l[`status_${status}`] ?? status;
};

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

/** Το κείμενο της περιγραφής μιας γραμμής στη γλώσσα του εγγράφου. */
export function lineLabel(line: InvoiceLine, lang: DocLang): string {
  const L = invoiceLabels(lang);
  switch (line.kind) {
    case "rental": {
      const days = line.days ?? 0;
      const d = days > 0 ? ` · ${days} ${days === 1 ? L.day : L.days}` : "";
      const rate = line.dailyRate !== undefined && days > 0 ? ` × ${eurEl(line.dailyRate)}` : "";
      return `${L.rental}${d}${rate}`;
    }
    case "extra":
      return `${L.extra}: ${line.name ?? ""}`.trim();
    case "extras":
      return L.extras;
    case "insurance":
      return line.name ? `${L.insurance}: ${line.name}` : L.insurance;
    case "discount":
      return line.name ? `${L.discount} (${line.name})` : L.discount;
    case "services":
      return L.services;
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
