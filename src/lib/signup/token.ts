// src/lib/signup/token.ts
// Token επαλήθευσης email — καθαρή λογική (tests χωρίς βάση).
//
// · 32 τυχαία bytes (base64url) ταξιδεύουν ΜΟΝΟ μέσα στο email.
// · Στη βάση ΜΟΝΟ το sha256 hash: διαρροή της βάσης δεν δίνει συνδέσμους.
// · Λήξη 24 ώρες, μίας χρήσης (usedAt). Νέα αποστολή ακυρώνει τα παλιά.

import { createHash, randomBytes } from "node:crypto";

export const VERIFY_TOKEN_HOURS = 24;
/** Ανεπιβεβαίωτες εγγραφές παλιότερες από αυτό → υποψήφιες για καθάρισμα. */
export const UNVERIFIED_CLEANUP_DAYS = 7;

const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface NewToken {
  /** Μόνο για το email — ΠΟΤΕ στη βάση ή στα logs. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export function createVerifyToken(now = new Date(), bytes: () => Buffer = () => randomBytes(32)): NewToken {
  const token = bytes().toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + VERIFY_TOKEN_HOURS * 3_600_000),
  };
}

/** Μορφή του token όπως ήρθε από το URL (πριν από οποιοδήποτε ερώτημα). */
export const isTokenShape = (raw: unknown): raw is string => typeof raw === "string" && TOKEN_RE.test(raw);

export type TokenState = "ok" | "invalid" | "expired" | "used";

/** Η κατάσταση μιας γραμμής tokens (null = δεν βρέθηκε). */
export function tokenState(
  row: { expiresAt: Date; usedAt: Date | null } | null,
  now = new Date()
): TokenState {
  if (!row) return "invalid";
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "ok";
}

/** Ο σύνδεσμος του email: <origin>/verify-email?token=… */
export function verifyUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
}
