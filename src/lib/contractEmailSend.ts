// src/lib/contractEmailSend.ts
// Η ροή «Αποστολή στον πελάτη» με ΕΓΧΥΟΜΕΝΕΣ εξαρτήσεις (βάση, Resend, PDF),
// ώστε να ελέγχεται ολόκληρη από τα tests χωρίς βάση και χωρίς δίκτυο.
// Το route (api/contracts/[id]/email) απλώς συνδέει τις πραγματικές.
//
// Σειρά ελέγχων:
//   ρόλος (403) → συμβόλαιο (404) → υπογραφή (409) → email (400) →
//   ενεργό link (409) → RESEND_API_KEY (500, δεν μετρά στο όριο) →
//   όριο 5/ώρα (429, ατομική κράτηση θέσης στη βάση) → PDF → Resend.

import type { ContractDTO } from "./contracts";
import type { PublicLinkDTO } from "./contractLink";
import { publicContractUrl } from "./contractLink";
import {
  EMAIL_MSG,
  EMAIL_SEND_LIMIT,
  emailContent,
  isEmail,
  maskEmail,
  type EmailLang,
  type EmailSendEntry,
} from "./contractEmail";

/** Ρόλοι που στέλνουν στον πελάτη. Ο συνεργάτης (PARTNER) όχι. */
export const EMAIL_SEND_ROLES = ["COMPANY_ADMIN", "STAFF"] as const;
export const canSendContractEmail = (role: string) =>
  (EMAIL_SEND_ROLES as readonly string[]).includes(role);

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: Buffer }[];
}

export type ReserveResult =
  | { ok: true; entry: EmailSendEntry }
  | { ok: false; recent: number; retryAt: string | null };

export interface EmailSendDeps {
  apiKey: string | undefined;
  from: string | undefined;
  /** Το συμβόλαιο (ήδη φιλτραρισμένο με contractScope) ή null. */
  loadContract: () => Promise<{ contract: ContractDTO; link: PublicLinkDTO; vatRate: number } | null>;
  /** Ατομικά: προσθέτει την προσπάθεια ΜΟΝΟ αν είναι κάτω από το όριο. */
  reserveAttempt: (entry: EmailSendEntry) => Promise<ReserveResult>;
  /** Ενημερώνει την προσπάθεια (ok/σφάλμα) και, σε επιτυχία, emailSentAt/To. */
  finishAttempt: (entryId: string, outcome: { ok: boolean; error?: string; sentTo?: string; at: Date }) => Promise<void>;
  buildPdf: (contract: ContractDTO, url: string, vatRate: number) => Promise<Uint8Array>;
  /** Επιστρέφει σύντομο κωδικό σφάλματος ή null σε επιτυχία. ΔΕΝ ρίχνει. */
  send: (apiKey: string, email: OutgoingEmail) => Promise<{ error: string | null }>;
  now: () => Date;
  newId: () => string;
}

export interface EmailSendRequest {
  role: string;
  userId: string;
  origin: string;
  lang: EmailLang;
}

export type EmailSendResult =
  | { status: 200; data: { sentAt: string; sentTo: string; lang: EmailLang } }
  | { status: 400 | 403 | 404 | 409 | 429 | 500 | 502; message: string; retryAt?: string | null };

/** Ποτέ email πελάτη ή δεδομένα κάρτας στα logs — μόνο κωδικοί. */
const log = (msg: string) => console.error(`[FleetPro] email συμβολαίου: ${msg}`);

export async function sendContractEmail(
  req: EmailSendRequest,
  deps: EmailSendDeps
): Promise<EmailSendResult> {
  if (!canSendContractEmail(req.role)) return { status: 403, message: EMAIL_MSG.partner };

  const loaded = await deps.loadContract();
  if (!loaded) return { status: 404, message: EMAIL_MSG.notFound };
  const { contract, link, vatRate } = loaded;

  if (contract.status === "DRAFT") return { status: 409, message: EMAIL_MSG.notSigned };

  const main = contract.drivers[0];
  const to = main?.email.trim() ?? "";
  if (!isEmail(to)) return { status: 400, message: EMAIL_MSG.noEmail };

  if (link.state !== "active" || !link.token) return { status: 409, message: EMAIL_MSG.linkInactive };

  // Χωρίς κλειδί δεν γίνεται καμία προσπάθεια → δεν μετρά στο όριο.
  const apiKey = deps.apiKey?.trim();
  if (!apiKey) {
    log("λείπει το RESEND_API_KEY");
    return { status: 500, message: EMAIL_MSG.noApiKey };
  }
  const from = deps.from?.trim() || "onboarding@resend.dev";

  const now = deps.now();
  const reserved = await deps.reserveAttempt({
    id: deps.newId(),
    at: now.toISOString(),
    ok: null,
    lang: req.lang,
    to: maskEmail(to),
    by: req.userId,
  });
  if (!reserved.ok) {
    return { status: 429, message: EMAIL_MSG.limit(Math.max(reserved.recent, EMAIL_SEND_LIMIT)), retryAt: reserved.retryAt };
  }
  const entryId = reserved.entry.id;

  const url = publicContractUrl(req.origin, link.token);
  let pdf: Uint8Array;
  try {
    pdf = await deps.buildPdf(contract, url, vatRate);
  } catch (e) {
    log(`αποτυχία PDF (${e instanceof Error ? e.name : "?"})`);
    await deps.finishAttempt(entryId, { ok: false, error: "pdf", at: deps.now() });
    return { status: 500, message: EMAIL_MSG.pdfFailed };
  }

  const s = contract.snapshot;
  const content = emailContent({
    lang: req.lang,
    companyName: s?.company.name ?? "",
    companyPhone: s?.company.phone ?? "",
    companyEmail: s?.company.email ?? "",
    contractNumber: contract.contractNumber,
    customerName: main.fullName,
    url,
    photoCount: contract.damagePhotos.length,
  });

  const { error } = await deps.send(apiKey, {
    from,
    to,
    subject: content.subject,
    text: content.text,
    html: content.html,
    attachments: [{ filename: content.filename, content: Buffer.from(pdf) }],
  });

  const at = deps.now();
  if (error) {
    log(`ο πάροχος απέρριψε την αποστολή (${error})`);
    await deps.finishAttempt(entryId, { ok: false, error, at });
    return { status: 502, message: EMAIL_MSG.failed };
  }
  await deps.finishAttempt(entryId, { ok: true, sentTo: to, at });
  return { status: 200, data: { sentAt: at.toISOString(), sentTo: to, lang: req.lang } };
}
