// src/lib/invoiceEmail.ts
// Αποστολή τιμολογίου στον πελάτη (email + PDF) — καθαρή λογική, ΧΩΡΙΣ
// runtime imports βάσης/δικτύου, ώστε να τη φορτώνουν η σελίδα, ο server και
// τα tests. Ίδια ροή με το συμβόλαιο (src/lib/contractEmail.ts), του οποίου
// ξαναχρησιμοποιούμε όριο, ιστορικό και μάσκα email.
//
//  · Παραλήπτης = το email του ΠΕΛΑΤΗ του τιμολογίου.
//  · Μόνο Διαχειριστής και Προσωπικό (όχι συνεργάτης).
//  · Όριο: 5 προσπάθειες ανά τιμολόγιο ανά ώρα.
//  · Κείμενο σύντομο, ΧΩΡΙΣ link και ΧΩΡΙΣ κανένα στοιχείο κάρτας.
//  · Τα logs γράφουν μόνο κωδικούς σφάλματος — ποτέ παραλήπτη ή κλειδιά.

import { stripCardNumbers } from "./contractEmail";
import { dmy, eurEl, invoicePdfFilename, type DocLang } from "./invoiceDocument";

/** Ρόλοι που κατεβάζουν/στέλνουν το PDF τιμολογίου. Ο συνεργάτης όχι. */
export const INVOICE_DOC_ROLES = ["COMPANY_ADMIN", "STAFF"] as const;
export const canExportInvoice = (role: string) =>
  (INVOICE_DOC_ROLES as readonly string[]).includes(role);

/* ─────────────────────────────────────────────
   Περιεχόμενο
   ───────────────────────────────────────────── */

export interface InvoiceEmailInput {
  lang: DocLang;
  companyName: string;
  companyPhone: string;
  companyEmail: string;
  code: string;
  customerName: string;
  total: number;
  dueDate: string;
  /** effectiveStatus του τιμολογίου. */
  status: string;
}

export interface InvoiceEmailContent {
  subject: string;
  text: string;
  html: string;
  filename: string;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export function invoiceEmailContent(i: InvoiceEmailInput): InvoiceEmailContent {
  const el = i.lang === "el";
  const company = i.companyName.trim() || (el ? "Η εταιρία ενοικίασης" : "The rental company");
  const name = stripCardNumbers(i.customerName.trim());
  const contact = [i.companyPhone.trim(), i.companyEmail.trim()].filter(Boolean).join(" · ");
  const amount = eurEl(i.total);
  const paid = i.status === "PAID";

  const subject = el ? `Τιμολόγιο ${i.code} — ${company}` : `Invoice ${i.code} — ${company}`;

  const greeting = el ? (name ? `Αγαπητέ/ή ${name},` : "Γεια σας,") : name ? `Dear ${name},` : "Hello,";
  const body = el
    ? `Σας στέλνουμε συνημμένο το τιμολόγιο ${i.code} (PDF), συνολικού ποσού ${amount}.`
    : `Please find attached invoice ${i.code} (PDF), for a total of ${amount}.`;
  const state = paid
    ? el
      ? "Το τιμολόγιο είναι εξοφλημένο — σας ευχαριστούμε για την πληρωμή."
      : "This invoice has been paid — thank you for your payment."
    : i.status === "CANCELLED"
      ? ""
      : el
        ? `Ημερομηνία λήξης: ${dmy(i.dueDate)}.`
        : `Due date: ${dmy(i.dueDate)}.`;
  const questions = el
    ? "Για οποιαδήποτε απορία, απαντήστε σε αυτό το email."
    : "If you have any questions, simply reply to this email.";
  const thanks = el ? "Με εκτίμηση," : "Kind regards,";

  const paragraphs = [greeting, body, state, questions].filter(Boolean);
  const signature = [thanks, company, ...(contact ? [contact] : [])];

  const text = [...paragraphs.flatMap((p) => [p, ""]), ...signature].join("\n");
  const p = (s: string) => `<p style="margin:0 0 12px">${s}</p>`;
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">',
    ...paragraphs.map((x) => p(escapeHtml(x))),
    p(signature.map(escapeHtml).join("<br>")),
    "</div>",
  ].join("");

  return { subject, text, html, filename: invoicePdfFilename(i.code) };
}

/* ─────────────────────────────────────────────
   Σφάλματα του παρόχου (Resend) → σαφές μήνυμα
   ───────────────────────────────────────────── */

export type ProviderErrorCode =
  | "testing_only"
  | "domain_unverified"
  | "invalid_key"
  | "quota"
  | "invalid_recipient"
  | "invalid_attachment"
  | "send_failed";

/**
 * Από το σφάλμα του Resend κρατάμε ΜΟΝΟ έναν κωδικό. Το μήνυμά του μπορεί να
 * περιέχει το email του λογαριασμού — δεν αποθηκεύεται και δεν γράφεται πουθενά.
 */
export function classifyProviderError(e: unknown): ProviderErrorCode {
  const o = (e && typeof e === "object" ? e : {}) as { name?: unknown; message?: unknown };
  const name = typeof o.name === "string" ? o.name : "";
  const msg = typeof o.message === "string" ? o.message : "";
  if (/testing emails|own email address/i.test(msg)) return "testing_only";
  if (name === "invalid_from_address" || /domain is not verified|verify (?:a|your) domain/i.test(msg)) {
    return "domain_unverified";
  }
  if (name === "missing_api_key" || name === "invalid_api_key" || name === "restricted_api_key") return "invalid_key";
  if (name === "rate_limit_exceeded" || name === "daily_quota_exceeded" || name === "monthly_quota_exceeded") {
    return "quota";
  }
  if (name === "invalid_attachment") return "invalid_attachment";
  if (/`to`|recipient/i.test(msg)) return "invalid_recipient";
  return "send_failed";
}

/* ─────────────────────────────────────────────
   Μηνύματα (ίδια για UI και server)
   ───────────────────────────────────────────── */

export const INVOICE_EMAIL_MSG = {
  role: "Η λήψη και η αποστολή τιμολογίου επιτρέπονται μόνο σε Διαχειριστή και Προσωπικό",
  notFound: "Το τιμολόγιο δεν βρέθηκε",
  cancelled: "Ακυρωμένο τιμολόγιο δεν στέλνεται στον πελάτη",
  noEmail: "Ο πελάτης δεν έχει έγκυρο email — συμπληρώστε το στην καρτέλα του πελάτη",
  noApiKey: "Η αποστολή email δεν έχει ρυθμιστεί: λείπει το RESEND_API_KEY στις ρυθμίσεις του server",
  limit: (n: number) =>
    `Έγιναν ήδη ${n} αποστολές αυτού του τιμολογίου την τελευταία ώρα. Δοκιμάστε ξανά αργότερα.`,
  pdfFailed: "Δεν ήταν δυνατή η δημιουργία του PDF",
  provider: {
    testing_only:
      "Το Resend επιτρέπει προς το παρόν αποστολή ΜΟΝΟ στο email του λογαριασμού Resend. Για αποστολή σε πελάτες χρειάζεται επαλήθευση domain στο Resend και αλλαγή του EMAIL_FROM.",
    domain_unverified:
      "Ο αποστολέας (EMAIL_FROM) δεν ανήκει σε επαληθευμένο domain στο Resend.",
    invalid_key: "Το κλειδί του Resend (RESEND_API_KEY) δεν είναι έγκυρο ή δεν επιτρέπει αποστολή.",
    quota: "Ξεπεράστηκε το όριο αποστολών του λογαριασμού Resend. Δοκιμάστε ξανά αργότερα.",
    invalid_recipient: "Ο πάροχος email απέρριψε τη διεύθυνση του πελάτη. Ελέγξτε το email του πελάτη.",
    invalid_attachment: "Ο πάροχος email απέρριψε το συνημμένο PDF.",
    send_failed: "Η αποστολή απέτυχε στον πάροχο email. Δοκιμάστε ξανά σε λίγο.",
  } satisfies Record<ProviderErrorCode, string>,
} as const;
