// src/lib/contractEmail.ts
// Αποστολή συμβολαίου στον πελάτη (email + PDF) — καθαρή λογική, ΧΩΡΙΣ
// runtime imports, ώστε να τη φορτώνουν η φόρμα, ο server και τα tests.
//
// Κανόνες:
//  · Παραλήπτης = το email του κύριου οδηγού (ο πρώτος).
//  · Γλώσσα: κενή χώρα ή Ελλάδα → ελληνικά, αλλιώς αγγλικά (αλλάζει στη φόρμα).
//  · Όριο: 5 προσπάθειες ανά συμβόλαιο ανά ώρα — μετρούν και οι αποτυχημένες
//    προς το Resend. Χωρίς RESEND_API_KEY δεν γίνεται προσπάθεια (δεν μετρά).
//  · ΠΟΤΕ πλήρης αριθμός κάρτας ή CVV σε email/PDF: μόνο «•••• 1234», και
//    κάθε σειρά 13+ ψηφίων αφαιρείται από κάθε ελεύθερο κείμενο.
//  · Τα logs (console) δεν γράφουν ποτέ email πελάτη ή στοιχεία κάρτας.

export const EMAIL_LANGS = ["el", "en"] as const;
export type EmailLang = (typeof EMAIL_LANGS)[number];

export const EMAIL_SEND_LIMIT = 5;
export const EMAIL_SEND_WINDOW_MS = 60 * 60 * 1000;

/** Απλός έλεγχος μορφής — η πραγματική επιβεβαίωση είναι η παράδοση. */
export const EMAIL_RE = /^[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[^\s@<>()[\]",;:]{2,}$/;
export const isEmail = (s: string | null | undefined): s is string =>
  typeof s === "string" && EMAIL_RE.test(s.trim());

/* ─────────────────────────────────────────────
   Γλώσσα
   ───────────────────────────────────────────── */

/** Μετά το fold (πεζά, χωρίς τόνους/κενά/σύμβολα). */
const GREECE = new Set(["ελλαδα", "ελλας", "greece", "hellas", "gr", "grc", "hellenicrepublic", "ελληνικηδημοκρατια"]);

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}]+/gu, "");

/** Κενή χώρα ή Ελλάδα → «el», οτιδήποτε άλλο → «en». */
export function suggestEmailLang(country: string | null | undefined): EmailLang {
  const c = fold(country ?? "");
  return c === "" || GREECE.has(c) ? "el" : "en";
}

/* ─────────────────────────────────────────────
   Ασφάλεια κειμένου
   ───────────────────────────────────────────── */

/** Αντικατάσταση για ό,τι μοιάζει με αριθμό κάρτας. */
export const REDACTED = "[•••]";

/**
 * Αφαιρεί από ελεύθερο κείμενο κάθε σειρά 13 ή περισσότερων ψηφίων — και
 * όταν χωρίζονται με ένα κενό, παύλα ή τελεία («4111 1111 1111 1111»).
 * Μικρότερες σειρές (τηλέφωνα, ημερομηνίες, ποσά) μένουν.
 */
export function stripCardNumbers(text: string): string {
  return text.replace(/\d(?:[ .\-]?\d)*/g, (run) =>
    run.replace(/\D/g, "").length >= 13 ? REDACTED : run
  );
}

/** Έχει το κείμενο σειρά 13+ ψηφίων; (για τα tests / έλεγχο εξόδου) */
export const containsCardLikeNumber = (text: string): boolean =>
  stripCardNumbers(text) !== text;

/** «g***@gmail.com» — για το ιστορικό αποστολών (όχι πλήρες email). */
export function maskEmail(email: string): string {
  const [user, domain] = email.trim().split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}

/* ─────────────────────────────────────────────
   Ιστορικό αποστολών (contracts."emailSendLog")
   ───────────────────────────────────────────── */

export interface EmailSendEntry {
  id: string;
  /** ISO — πότε ξεκίνησε η προσπάθεια. */
  at: string;
  /** null = σε εξέλιξη. */
  ok: boolean | null;
  lang: EmailLang;
  /** Μασκαρισμένο email (maskEmail). */
  to: string;
  by: string | null;
  /** Σύντομος κωδικός σφάλματος του Resend (χωρίς δεδομένα πελάτη). */
  error?: string;
}

export function readSendLog(value: unknown): EmailSendEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    if (typeof o.at !== "string") return [];
    return [
      {
        id: typeof o.id === "string" ? o.id : "",
        at: o.at,
        ok: typeof o.ok === "boolean" ? o.ok : null,
        lang: o.lang === "en" ? "en" : "el",
        to: typeof o.to === "string" ? o.to : "",
        by: typeof o.by === "string" ? o.by : null,
        ...(typeof o.error === "string" ? { error: o.error } : {}),
      } satisfies EmailSendEntry,
    ];
  });
}

/** Πόσες προσπάθειες έγιναν την τελευταία ώρα (όλες, και οι αποτυχημένες). */
export function recentAttempts(log: EmailSendEntry[], now: Date = new Date()): number {
  const from = now.getTime() - EMAIL_SEND_WINDOW_MS;
  return log.filter((e) => {
    const t = Date.parse(e.at);
    return Number.isFinite(t) && t > from;
  }).length;
}

/** Πότε ξαναεπιτρέπεται αποστολή (ISO) όταν έχει πιαστεί το όριο. */
export function nextAllowedAt(log: EmailSendEntry[], now: Date = new Date()): string | null {
  const from = now.getTime() - EMAIL_SEND_WINDOW_MS;
  const times = log
    .map((e) => Date.parse(e.at))
    .filter((t) => Number.isFinite(t) && t > from)
    .sort((a, b) => a - b);
  if (times.length < EMAIL_SEND_LIMIT) return null;
  return new Date(times[times.length - EMAIL_SEND_LIMIT] + EMAIL_SEND_WINDOW_MS).toISOString();
}

/* ─────────────────────────────────────────────
   Περιεχόμενο email
   ───────────────────────────────────────────── */

export interface EmailContentInput {
  lang: EmailLang;
  companyName: string;
  companyPhone: string;
  companyEmail: string;
  contractNumber: string;
  customerName: string;
  url: string;
  /** Πλήθος φωτογραφιών ζημιών (δεν επισυνάπτονται — είναι στο link). */
  photoCount: number;
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
  filename: string;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Όνομα συνημμένου: μόνο ασφαλείς χαρακτήρες. */
export const pdfFilename = (contractNumber: string) =>
  `contract-${contractNumber.replace(/[^A-Za-z0-9_-]/g, "") || "copy"}.pdf`;

export function emailContent(i: EmailContentInput): EmailContent {
  const el = i.lang === "el";
  const company = i.companyName.trim() || (el ? "Η εταιρία ενοικίασης" : "The rental company");
  const name = i.customerName.trim();
  const contact = [i.companyPhone.trim(), i.companyEmail.trim()].filter(Boolean).join(" · ");

  const subject = el
    ? `Το συμβόλαιο ενοικίασης ${i.contractNumber} — ${company}`
    : `Your rental agreement ${i.contractNumber} — ${company}`;

  const photos =
    i.photoCount > 0
      ? el
        ? `Οι φωτογραφίες ζημιών (${i.photoCount}) υπάρχουν στο link.`
        : `The damage photos (${i.photoCount}) are available at the link.`
      : "";

  const lines = el
    ? [
        name ? `Αγαπητέ/ή ${name},` : "Γεια σας,",
        "",
        `Σας στέλνουμε αντίγραφο του υπογεγραμμένου συμβολαίου ενοικίασης ${i.contractNumber} (συνημμένο PDF).`,
        "",
        "Δείτε το συμβόλαιο online:",
        i.url,
        ...(photos ? ["", photos] : []),
        "",
        "Ευχαριστούμε,",
        company,
        ...(contact ? [contact] : []),
      ]
    : [
        name ? `Dear ${name},` : "Hello,",
        "",
        `Please find attached a copy of your signed rental agreement ${i.contractNumber} (PDF).`,
        "",
        "View the agreement online:",
        i.url,
        ...(photos ? ["", photos] : []),
        "",
        "Thank you,",
        company,
        ...(contact ? [contact] : []),
      ];

  // Κανένα ελεύθερο κείμενο δεν περνά χωρίς φίλτρο αριθμών κάρτας.
  const text = stripCardNumbers(lines.join("\n"));
  const safe = (s: string) => escapeHtml(stripCardNumbers(s));
  const p = (s: string) => `<p style="margin:0 0 12px">${s}</p>`;
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">',
    p(safe(lines[0])),
    p(
      safe(
        el
          ? `Σας στέλνουμε αντίγραφο του υπογεγραμμένου συμβολαίου ενοικίασης ${i.contractNumber} (συνημμένο PDF).`
          : `Please find attached a copy of your signed rental agreement ${i.contractNumber} (PDF).`
      )
    ),
    p(
      `<a href="${escapeHtml(i.url)}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">${
        el ? "Δείτε το συμβόλαιο online" : "View the agreement online"
      }</a>`
    ),
    p(`<span style="font-size:13px;color:#6b7280">${escapeHtml(i.url)}</span>`),
    photos ? p(safe(photos)) : "",
    p(`${el ? "Ευχαριστούμε," : "Thank you,"}<br>${safe(company)}${contact ? `<br>${safe(contact)}` : ""}`),
    "</div>",
  ].join("");

  return { subject: stripCardNumbers(subject), text, html, filename: pdfFilename(i.contractNumber) };
}

/* ─────────────────────────────────────────────
   Μηνύματα (ίδια για UI και server)
   ───────────────────────────────────────────── */

export const EMAIL_MSG = {
  partner: "Η αποστολή στον πελάτη επιτρέπεται μόνο σε Διαχειριστή και Προσωπικό",
  notFound: "Το συμβόλαιο δεν βρέθηκε",
  notSigned: "Το συμβόλαιο στέλνεται μόνο αφού υπογράψουν όλοι οι οδηγοί",
  noEmail: "Λείπει email πελάτη (κύριος οδηγός)",
  linkInactive: "Το link πελάτη δεν είναι ενεργό — φτιάξτε νέο link και ξαναδοκιμάστε",
  noApiKey: "Η αποστολή email δεν έχει ρυθμιστεί: λείπει το RESEND_API_KEY στις ρυθμίσεις του server",
  limit: (n: number) =>
    `Έγιναν ήδη ${n} αποστολές αυτού του συμβολαίου την τελευταία ώρα. Δοκιμάστε ξανά αργότερα.`,
  failed: "Η αποστολή απέτυχε στον πάροχο email. Δοκιμάστε ξανά σε λίγο.",
  pdfFailed: "Δεν ήταν δυνατή η δημιουργία του PDF",
} as const;
