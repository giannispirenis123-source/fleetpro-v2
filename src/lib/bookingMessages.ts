// src/lib/bookingMessages.ts
// Τα μηνύματα προς τον πελάτη όταν η εταιρία ΕΠΙΒΕΒΑΙΩΝΕΙ ή ΑΚΥΡΩΝΕΙ μια
// κράτηση. Καθαρό module (χωρίς βάση/δίκτυο): το ίδιο κείμενο βγαίνει στην
// προεπισκόπηση του dashboard, στο email (Resend), στο WhatsApp και στο mailto.
//
// · Γλώσσα: του site στην υποβολή (bookings.siteLang)· αλλιώς η προεπιλογή
//   της εταιρίας· αλλιώς ελληνικά. Τα σταθερά κείμενα ζουν στα λεξικά του
//   δημόσιου site (src/lib/storefront/i18n.ts).
// · Σύνολο: ΜΟΝΟ από το αποθηκευμένο priceQuote (κανένας νέος υπολογισμός).
// · Ποτέ τηλέφωνο/πτήση/σχόλια του πελάτη μέσα στο κείμενο.

import { fill, formatDay, formatEuro, isStorefrontLanguage, storefrontDictionary } from "./storefront/i18n";

export const MESSAGE_KINDS = ["confirm", "cancel"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_CHANNELS = ["email", "whatsapp", "mailto"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** Συνηθισμένοι λόγοι ακύρωσης — ο κωδικός αποθηκεύεται, το κείμενο βγαίνει στη γλώσσα του πελάτη. */
export const CANCEL_REASONS = ["no_vehicle", "customer_request", "invalid_details", "driver_age", "other"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
/** Λόγοι που βάζει ΜΟΝΟ το σύστημα (δεν εμφανίζονται στη λίστα του διαχειριστή). */
export const SYSTEM_CANCEL_REASONS = ["payment_not_completed"] as const;
export const isCancelReason = (v: unknown): v is CancelReason =>
  typeof v === "string" && ([...CANCEL_REASONS, ...SYSTEM_CANCEL_REASONS] as readonly string[]).includes(v);

/** Όριο του ελεύθερου κειμένου ακύρωσης. */
export const CANCEL_NOTE_MAX = 300;

/** Η γλώσσα του μηνύματος: του site → της εταιρίας → ελληνικά. */
export function messageLang(siteLang: string | null | undefined, tenantDefault: string | null | undefined): string {
  if (isStorefrontLanguage(siteLang)) return siteLang;
  if (isStorefrontLanguage(tenantDefault)) return tenantDefault;
  return "el";
}

export interface MessageData {
  kind: MessageKind;
  lang: string;
  /** Ο δημόσιος κωδικός (XXXX-XXXX)· σε κράτηση του dashboard ο αριθμός της. */
  code: string;
  firstName: string;
  /** Ήδη στη γλώσσα του μηνύματος: «Κατηγορία B» + «Fiat Panda» → «… ή παρόμοιο». */
  groupName: string;
  groupSimilar: string | null;
  /** "YYYY-MM-DDTHH:mm" */
  from: string;
  to: string;
  pickupLocation: string | null;
  returnLocation: string | null;
  /** Από το αποθηκευμένο priceQuote (ή το αποθηκευμένο σύνολο σε παλιά κράτηση). */
  totalCents: number;
  /**
   * Το επίπεδο ασφάλειας (ήδη στη γλώσσα του μηνύματος) από το priceQuote:
   * null = χωρίς πρόσθετη ασφάλεια· undefined = άγνωστο (παλιά κράτηση) → καμία γραμμή.
   */
  insuranceName?: string | null;
  company: { name: string; phone: string | null; email: string | null };
  /** Πλήρη URL — null όταν η κράτηση δεν είναι από το site. */
  bookingUrl: string | null;
  searchUrl: string | null;
  reasonCode?: string | null;
  note?: string | null;
  /**
   * Online πληρωμή (SQL 27): ό,τι πληρώθηκε/επιστράφηκε. undefined/null =
   * πληρωμή στην παραλαβή (όπως πριν).
   */
  payment?: { paidCents: number; refundedCents: number } | null;
}

export interface BookingMessage {
  lang: string;
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Ό,τι γράφει ο διαχειριστής: μία γραμμή, χωρίς HTML, με όριο. */
export function cleanNote(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, CANCEL_NOTE_MAX);
  return t || null;
}

/** "YYYY-MM-DDTHH:mm" → «Παρ 11 Δεκ 2026, 10:00». */
function when(value: string, lang: string): string {
  const d = storefrontDictionary(lang);
  return `${formatDay(value.slice(0, 10), d)} ${value.slice(0, 4)}, ${value.slice(11, 16)}`;
}

/** Το κείμενο του λόγου ακύρωσης στη γλώσσα του πελάτη (λίστα + ελεύθερο κείμενο). */
export function cancelReasonText(lang: string, code: string | null | undefined, note: string | null | undefined): string | null {
  const d = storefrontDictionary(lang);
  const preset = isCancelReason(code) ? d.cancelReasons[code] ?? "" : "";
  const extra = cleanNote(note);
  const parts = [preset, extra].filter((x): x is string => !!x && x.length > 0);
  return parts.length ? parts.join(" ") : null;
}

export function buildBookingMessage(m: MessageData): BookingMessage {
  const lang = isStorefrontLanguage(m.lang) ? m.lang : "el";
  const d = storefrontDictionary(lang);
  const company = m.company.name;
  const vehicle = m.groupSimilar ? `${m.groupName} (${fill(d.orSimilar, { name: m.groupSimilar })})` : m.groupName;
  const place = (p: string | null) => (p ? ` · ${p}` : "");
  const euro = (cents: number) => formatEuro(Math.round(cents) / 100, lang);
  const paid = m.payment && m.payment.paidCents > 0 ? m.payment.paidCents : 0;
  const payLines = (): string[] => {
    if (paid === 0) return [d.msgPayAtPickup];
    const balance = Math.max(0, Math.round(m.totalCents) - paid);
    return [fill(d.msgPaidOnline, { amount: euro(paid) }), ...(balance > 0 ? [fill(d.msgBalanceOnPickup, { amount: euro(balance) })] : [])];
  };

  const contact =
    m.company.phone && m.company.email
      ? fill(d.msgContactBoth, { phone: m.company.phone, email: m.company.email })
      : m.company.phone
        ? fill(d.msgContactPhone, { phone: m.company.phone })
        : m.company.email
          ? fill(d.msgContactEmail, { email: m.company.email })
          : null;

  // Παράγραφοι (κάθε στοιχείο = μία παράγραφος· οι γραμμές ενός block με \n).
  const blocks: string[] = [fill(d.msgHello, { name: m.firstName })];
  if (m.kind === "confirm") {
    blocks.push(fill(d.msgConfirmIntro, { company }));
    blocks.push(
      [
        fill(d.msgCode, { code: m.code }),
        fill(d.msgVehicle, { name: vehicle }),
        fill(d.msgPickup, { when: when(m.from, lang) + place(m.pickupLocation) }),
        fill(d.msgDropoff, { when: when(m.to, lang) + place(m.returnLocation ?? m.pickupLocation) }),
        ...(m.insuranceName === undefined ? [] : [fill(d.msgInsurance, { name: m.insuranceName || d.noInsuranceChosen })]),
        fill(d.msgTotal, { amount: formatEuro(Math.round(m.totalCents) / 100, lang) }),
        ...payLines(),
      ].join("\n")
    );
    if (m.bookingUrl) blocks.push(fill(d.msgViewBooking, { url: m.bookingUrl }));
  } else {
    blocks.push(fill(d.msgCancelIntro, { code: m.code }));
    const reason = cancelReasonText(lang, m.reasonCode, m.note);
    if (reason) blocks.push(fill(d.msgReason, { reason }));
    // Πληρωμένη online: τι γίνεται με τα χρήματα (η επιστροφή ΔΕΝ είναι αυτόματη).
    if (paid > 0) {
      blocks.push(
        m.payment!.refundedCents > 0
          ? fill(d.msgRefunded, { amount: euro(m.payment!.refundedCents) })
          : fill(d.msgRefundPending, { amount: euro(paid) })
      );
    }
    if (m.searchUrl) blocks.push(fill(d.msgNewSearch, { url: m.searchUrl }));
  }
  if (contact) blocks.push(contact);
  blocks.push(`${d.msgSignoff}\n${company}`);

  const subject = fill(m.kind === "confirm" ? d.msgConfirmSubject : d.msgCancelSubject, { code: m.code, company });
  const text = blocks.join("\n\n");
  const linkify = (s: string) =>
    escapeHtml(s).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:#2563eb">${u}</a>`);
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">',
    ...blocks.map((b) => `<p style="margin:0 0 12px">${b.split("\n").map(linkify).join("<br>")}</p>`),
    "</div>",
  ].join("");
  return { lang, subject, text, html };
}

/* ─────────────────────────────────────────────
   Χειροκίνητη αποστολή (WhatsApp / mailto)
   ───────────────────────────────────────────── */

/**
 * Τηλέφωνο → μόνο ψηφία με κωδικό χώρας, για το wa.me. «+30 69…» → «3069…»,
 * «0030…» → «30…». Ελληνικό κινητό χωρίς κωδικό (10 ψηφία, 69…) → «30…».
 * Κάτι που δεν μοιάζει με αριθμό → null (χωρίς κουμπί).
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^69\d{8}$/.test(digits)) digits = `30${digits}`;
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const n = whatsappNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

export function mailtoLink(email: string | null | undefined, subject: string, text: string): string | null {
  if (!email || !/^[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[^\s@<>()[\]",;:]{2,}$/.test(email.trim())) return null;
  return `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

/* ─────────────────────────────────────────────
   Κατάσταση αποστολής για το dashboard
   ───────────────────────────────────────────── */

export type MessageState = "sent" | "failed" | "none";

/**
 * «Στάλθηκε / Δεν στάλθηκε / Δεν έχει σταλεί» για ένα είδος μηνύματος.
 * Στάλθηκε = email με επιτυχία ή άνοιγμα WhatsApp/mailto από χρήστη.
 */
export function messageState(rows: { kind: string; result: string }[], kind: MessageKind): MessageState {
  const mine = rows.filter((r) => r.kind === kind);
  if (mine.some((r) => r.result === "sent" || r.result === "opened")) return "sent";
  if (mine.some((r) => r.result === "failed")) return "failed";
  return "none";
}

/** Έχει ήδη φύγει email αυτού του είδους; Τότε δεν ξαναστέλνεται αυτόματα. */
export const emailAlreadySent = (rows: { kind: string; channel: string; result: string }[], kind: MessageKind) =>
  rows.some((r) => r.kind === kind && r.channel === "email" && r.result === "sent");

/** Το μήνυμα που αντιστοιχεί στην τρέχουσα κατάσταση (για τα κουμπιά WhatsApp/email). */
export const kindForStatus = (status: string): MessageKind | null =>
  status === "CONFIRMED" || status === "ACTIVE" ? "confirm" : status === "CANCELLED" ? "cancel" : null;
