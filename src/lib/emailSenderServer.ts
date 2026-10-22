// src/lib/emailSenderServer.ts
// Ο αποστολέας των email μιας εταιρίας — ΜΟΝΟ server. Η λογική στο emailSender.ts.

import { db } from "./db";
import {
  chooseEmailFrom,
  normalizeSenderAddress,
  sanitizeSenderName,
  senderDomain,
  type EmailSenderInput,
} from "./emailSender";

const SENDER_SELECT = {
  emailFromName: true,
  emailFromAddress: true,
  emailSenderStatus: true,
  emailSenderVerifiedAt: true,
} as const;

/** Για τα 3 σημεία αποστολής (συμβόλαιο, τιμολόγιο, απόφαση κράτησης). */
export async function emailFromForTenant(tenantId: string | null | undefined): Promise<string | undefined> {
  const fallback = process.env.EMAIL_FROM;
  if (!tenantId) return fallback;
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: SENDER_SELECT });
  return chooseEmailFrom(t, fallback);
}

export interface EmailSenderDTO {
  name: string;
  address: string;
  status: "UNVERIFIED" | "VERIFIED";
  verifiedAt: string | null;
  domain: string | null;
  /** Τι χρησιμοποιείται ΤΩΡΑ (δικός σας ή «κοινός αποστολέας της πλατφόρμας»). */
  usingOwn: boolean;
}

export async function loadEmailSender(tenantId: string): Promise<EmailSenderDTO | null> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: SENDER_SELECT });
  if (!t) return null;
  const status = t.emailSenderStatus === "VERIFIED" ? "VERIFIED" : "UNVERIFIED";
  return {
    name: t.emailFromName ?? "",
    address: t.emailFromAddress ?? "",
    status,
    verifiedAt: t.emailSenderVerifiedAt?.toISOString() ?? null,
    domain: senderDomain(t.emailFromAddress),
    usingOwn: chooseEmailFrom(t, undefined) !== undefined,
  };
}

/**
 * Αποθήκευση. Η κατάσταση VERIFIED δίνεται ΜΟΝΟ με έγκυρη διεύθυνση· αλλαγή
 * διεύθυνσης χωρίς ρητό τικ → UNVERIFIED (ποτέ δεν «κληρονομείται» η επαλήθευση).
 */
export async function saveEmailSender(tenantId: string, input: EmailSenderInput, now = new Date()): Promise<void> {
  const current = await db.tenant.findUnique({ where: { id: tenantId }, select: SENDER_SELECT });
  const address = normalizeSenderAddress(input.address);
  const name = sanitizeSenderName(input.name) || null;
  const verified = input.verified && address !== null;
  const keepTime = verified && current?.emailSenderStatus === "VERIFIED" && current.emailFromAddress === address;
  await db.tenant.update({
    where: { id: tenantId },
    data: {
      emailFromName: name,
      emailFromAddress: address,
      emailSenderStatus: verified ? "VERIFIED" : "UNVERIFIED",
      emailSenderVerifiedAt: verified ? (keepTime ? current!.emailSenderVerifiedAt : now) : null,
    },
  });
}
