// src/lib/invoiceEmailSend.ts
// Η ροή «Αποστολή στον πελάτη» του τιμολογίου με ΕΓΧΥΟΜΕΝΕΣ εξαρτήσεις
// (βάση, Resend, PDF), ώστε να ελέγχεται από τα tests χωρίς βάση και δίκτυο.
// Το route (api/invoices/[id]/email) απλώς συνδέει τις πραγματικές.
//
// Σειρά ελέγχων:
//   ρόλος (403) → τιμολόγιο της εταιρίας (404) → ακυρωμένο (409) →
//   email πελάτη (400) → RESEND_API_KEY (500, δεν μετρά στο όριο) →
//   όριο 5/ώρα (429, ατομική κράτηση θέσης στη βάση) → PDF → Resend.

import { EMAIL_SEND_LIMIT, isEmail, maskEmail, type EmailSendEntry } from "./contractEmail";
import type { DocLang, InvoiceDoc } from "./invoiceDocument";
import {
  INVOICE_EMAIL_MSG,
  canExportInvoice,
  invoiceEmailContent,
  type ProviderErrorCode,
} from "./invoiceEmail";
import { AMOUNT_BLOCKED_MESSAGE, AmountIntegrityError, htmlToCheckText, verifyOutgoingAmounts } from "./public/outgoingAmounts";
import { toCents } from "./public/money";

export interface OutgoingInvoiceEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: Buffer }[];
}

export type ReserveResult =
  | { ok: true; entry: EmailSendEntry }
  | { ok: false; recent: number; retryAt: string | null };

export interface InvoiceEmailDeps {
  apiKey: string | undefined;
  from: string | undefined;
  /** Το τιμολόγιο ΤΗΣ ΕΤΑΙΡΙΑΣ του χρήστη, ή null. */
  loadInvoice: () => Promise<{ doc: InvoiceDoc; customerEmail: string | null } | null>;
  /** Ατομικά: προσθέτει την προσπάθεια ΜΟΝΟ αν είναι κάτω από το όριο. */
  reserveAttempt: (entry: EmailSendEntry) => Promise<ReserveResult>;
  /** Ενημερώνει την προσπάθεια και, σε επιτυχία, emailSentAt/To. */
  finishAttempt: (entryId: string, outcome: { ok: boolean; error?: string; sentTo?: string; at: Date }) => Promise<void>;
  /** Το δίγλωσσο PDF — ίδιο όποια γλώσσα κι αν έχει το email. */
  buildPdf: (doc: InvoiceDoc) => Promise<Uint8Array>;
  /** Κωδικός σφάλματος ή null σε επιτυχία. ΔΕΝ ρίχνει. */
  send: (apiKey: string, email: OutgoingInvoiceEmail) => Promise<{ error: ProviderErrorCode | null }>;
  now: () => Date;
  newId: () => string;
}

export interface InvoiceEmailRequest {
  role: string;
  userId: string;
  lang: DocLang;
}

export type InvoiceEmailResult =
  | { status: 200; data: { sentAt: string; sentTo: string; lang: DocLang } }
  | { status: 400 | 403 | 404 | 409 | 429 | 500 | 502; message: string; retryAt?: string | null };

/** Ποτέ παραλήπτης, κλειδιά ή κάρτα στα logs — μόνο κωδικοί. */
const log = (msg: string) => console.error(`[FleetPro] email τιμολογίου: ${msg}`);

export async function sendInvoiceEmail(
  req: InvoiceEmailRequest,
  deps: InvoiceEmailDeps
): Promise<InvoiceEmailResult> {
  if (!canExportInvoice(req.role)) return { status: 403, message: INVOICE_EMAIL_MSG.role };

  const loaded = await deps.loadInvoice();
  if (!loaded) return { status: 404, message: INVOICE_EMAIL_MSG.notFound };
  const { doc } = loaded;

  if (doc.status === "CANCELLED") return { status: 409, message: INVOICE_EMAIL_MSG.cancelled };

  const to = loaded.customerEmail?.trim() ?? "";
  if (!isEmail(to)) return { status: 400, message: INVOICE_EMAIL_MSG.noEmail };

  // Χωρίς κλειδί δεν γίνεται καμία προσπάθεια → δεν μετρά στο όριο.
  const apiKey = deps.apiKey?.trim();
  if (!apiKey) {
    log("λείπει το RESEND_API_KEY");
    return { status: 500, message: INVOICE_EMAIL_MSG.noApiKey };
  }
  const from = deps.from?.trim() || "onboarding@resend.dev";

  const reserved = await deps.reserveAttempt({
    id: deps.newId(),
    at: deps.now().toISOString(),
    ok: null,
    lang: req.lang,
    to: maskEmail(to),
    by: req.userId,
  });
  if (!reserved.ok) {
    return {
      status: 429,
      message: INVOICE_EMAIL_MSG.limit(Math.max(reserved.recent, EMAIL_SEND_LIMIT)),
      retryAt: reserved.retryAt,
    };
  }
  const entryId = reserved.entry.id;

  let pdf: Uint8Array;
  try {
    pdf = await deps.buildPdf(doc);
  } catch (e) {
    // Έλεγχος ποσών του PDF: ασυμφωνία → ΔΕΝ στέλνεται.
    if (e instanceof AmountIntegrityError) {
      log(`μπλοκαρίστηκε από τον έλεγχο ποσών (${e.code})`);
      await deps.finishAttempt(entryId, { ok: false, error: `amount:${e.code}`, at: deps.now() });
      return { status: 409, message: AMOUNT_BLOCKED_MESSAGE };
    }
    log(`αποτυχία PDF (${e instanceof Error ? e.name : "?"})`);
    await deps.finishAttempt(entryId, { ok: false, error: "pdf", at: deps.now() });
    return { status: 500, message: INVOICE_EMAIL_MSG.pdfFailed };
  }

  const content = invoiceEmailContent({
    lang: req.lang,
    companyName: doc.company.name,
    companyPhone: doc.company.phone ?? "",
    companyEmail: doc.company.email ?? "",
    code: doc.code,
    customerName: doc.customer.name,
    total: doc.total,
    dueDate: doc.dueDate,
    status: doc.status,
  });

  // Έλεγχος ποσών του email: μόνο το ΑΠΟΘΗΚΕΥΜΕΝΟ σύνολο, ΜΙΑ φορά στη φράση συνόλου.
  const spec = { totalCents: toCents(doc.total), totalLine: content.totalPhrase };
  const check = verifyOutgoingAmounts([content.text, htmlToCheckText(content.html)], spec);
  const subjectCheck = verifyOutgoingAmounts(content.subject, { ...spec, totalLine: null });
  const failed = !check.ok ? check : !subjectCheck.ok ? subjectCheck : null;
  if (failed && !failed.ok) {
    log(`μπλοκαρίστηκε από τον έλεγχο ποσών (${failed.code})`);
    await deps.finishAttempt(entryId, { ok: false, error: `amount:${failed.code}`, at: deps.now() });
    return { status: 409, message: AMOUNT_BLOCKED_MESSAGE };
  }

  const replyTo = doc.company.email?.trim();
  const { error } = await deps.send(apiKey, {
    from,
    to,
    ...(replyTo && isEmail(replyTo) ? { replyTo } : {}),
    subject: content.subject,
    text: content.text,
    html: content.html,
    attachments: [{ filename: content.filename, content: Buffer.from(pdf) }],
  });

  const at = deps.now();
  if (error) {
    log(`ο πάροχος απέρριψε την αποστολή (${error})`);
    await deps.finishAttempt(entryId, { ok: false, error, at });
    return { status: 502, message: INVOICE_EMAIL_MSG.provider[error] ?? INVOICE_EMAIL_MSG.provider.send_failed };
  }
  await deps.finishAttempt(entryId, { ok: true, sentTo: to, at });
  return { status: 200, data: { sentAt: at.toISOString(), sentTo: to, lang: req.lang } };
}
