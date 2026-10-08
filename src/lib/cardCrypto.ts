// src/lib/cardCrypto.ts
// Πλήρης αριθμός κάρτας: κρυπτογράφηση AES-256-GCM ΜΟΝΟ στον server.
//
//  · Κλειδί: env CARD_ENCRYPTION_KEY = 32 bytes σε base64. Αν λείπει ή
//    είναι λάθος, η αποθήκευση πλήρους αριθμού ΑΠΟΤΥΓΧΑΝΕΙ με καθαρό
//    μήνυμα (CardKeyError) — ποτέ σιωπηλά, ποτέ αποθήκευση χωρίς κρυπτογράφηση.
//  · Στήλη contracts."cardNumberEnc": JSON { payment?, deposit? }, όπου η
//    κάθε τιμή είναι ξεχωριστά κρυπτογραφημένη ("v1.<iv>.<tag>.<data>",
//    base64url). Έτσι η αφαίρεση μιας κάρτας δεν χρειάζεται το κλειδί.
//  · Ο αριθμός ΠΟΤΕ σε logs, Α4, σελίδα πελάτη ή searchText. Κανένα CVV.
//
// Χωρίς σχετικά imports, ώστε να το φορτώνουν και τα tests.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class CardKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardKeyError";
  }
}

const MISSING =
  "Λείπει το CARD_ENCRYPTION_KEY στις ρυθμίσεις του server — ο πλήρης αριθμός κάρτας δεν αποθηκεύτηκε.";
const INVALID =
  "Το CARD_ENCRYPTION_KEY δεν είναι έγκυρο (χρειάζονται 32 bytes σε base64) — ο πλήρης αριθμός κάρτας δεν αποθηκεύτηκε.";

/** Το κλειδί από το env (ή από το όρισμα, για τα tests). */
export function cardKey(raw: string | undefined = process.env.CARD_ENCRYPTION_KEY): Buffer {
  const value = (raw ?? "").trim();
  if (!value) throw new CardKeyError(MISSING);
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new CardKeyError(INVALID);
  return key;
}

export function encryptCardNumber(digits: string, key: Buffer = cardKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(digits, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptCardNumber(token: string, key: Buffer = cardKey()): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Άγνωστη μορφή κρυπτογραφημένης κάρτας");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export type CardSlot = "payment" | "deposit";
type Stored = Partial<Record<CardSlot, string>>;

/** Αμυντική ανάγνωση της στήλης: { payment?, deposit? } με κρυπτογραφημένες τιμές. */
export function readCardNumbersEnc(enc: string | null | undefined): Stored {
  if (!enc) return {};
  try {
    const o = JSON.parse(enc) as Record<string, unknown>;
    const out: Stored = {};
    for (const k of ["payment", "deposit"] as const) {
      if (typeof o[k] === "string" && o[k]) out[k] = o[k] as string;
    }
    return out;
  } catch {
    return {};
  }
}

/** Ποιες κάρτες έχουν αποθηκευμένο πλήρη αριθμό (χωρίς αποκρυπτογράφηση). */
export function storedCardNumbers(enc: string | null | undefined): Record<CardSlot, boolean> {
  const s = readCardNumbersEnc(enc);
  return { payment: !!s.payment, deposit: !!s.deposit };
}

/**
 * Η νέα τιμή της στήλης. Ανά κάρτα: νέος αριθμός (ψηφία) → κρυπτογράφηση·
 * null → διαγραφή· undefined → μένει ό,τι υπήρχε. Κάρτα που δεν ισχύει πια
 * (άλλος τρόπος πληρωμής/εγγύησης) → διαγραφή. Κλειδί χρειάζεται ΜΟΝΟ όταν
 * υπάρχει νέος αριθμός.
 */
export function nextCardNumbersEnc(
  currentEnc: string | null | undefined,
  next: Partial<Record<CardSlot, string | null>>,
  present: Record<CardSlot, boolean>,
  key?: Buffer
): string | null {
  const out = readCardNumbersEnc(currentEnc);
  for (const k of ["payment", "deposit"] as const) {
    const v = next[k];
    if (!present[k] || v === null) delete out[k];
    else if (typeof v === "string") out[k] = encryptCardNumber(v, key ?? cardKey());
  }
  return out.payment || out.deposit ? JSON.stringify(out) : null;
}
