// src/lib/billing/founding.ts
// Πρόγραμμα «Πρώτες 10 εταιρίες» — καθαρή λογική (κωδικοί, θέσεις). Η
// ατομική διεκδίκηση με τη βάση: foundingServer.ts.
//
// ΑΣΦΑΛΕΙΑ:
// · Στη βάση ΜΟΝΟ sha256 του κωδικού (μετά από κανονικοποίηση)· ο κωδικός
//   φαίνεται ΜΙΑ φορά, όταν τον φτιάχνει ο Super Admin.
// · Λάθος, ληγμένος, ανενεργός ή εξαντλημένος κωδικός → ΙΔΙΟ μήνυμα («δεν
//   είναι έγκυρος»): δεν μαντεύεται ποιος υπάρχει. Μόνο το «έκλεισε» είναι
//   διαφορετικό, γιατί οι θέσεις που απομένουν είναι ούτως ή άλλως δημόσιες.
// · Όριο προσπαθειών ανά IP (LIMITS.founderCodePerIp).

import { createHash, randomInt } from "node:crypto";

export const FOUNDING_TOTAL = 10;
export const FOUNDING_PROGRAM_ID = "founding";

/** Χωρίς 0/O, 1/I/L — διαβάζεται και υπαγορεύεται εύκολα στο τηλέφωνο. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Κεφαλαία, μόνο γράμματα/αριθμοί («fp-ab12 cd34» = «FPAB12CD34»). */
export const normalizeFounderCode = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Δεκτό σχήμα κωδικού (πριν από κάθε ερώτημα στη βάση). */
export const isFounderCodeShape = (raw: unknown): raw is string => {
  if (typeof raw !== "string" || raw.length > 40) return false;
  const n = normalizeFounderCode(raw);
  return n.length >= 6 && n.length <= 24;
};

export const hashFounderCode = (raw: string): string =>
  createHash("sha256").update(`fleetpro-founder|${normalizeFounderCode(raw)}`).digest("hex");

/** Νέος κωδικός: FP-XXXX-XXXX (~39 bit). */
export function generateFounderCode(): string {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `FP-${part()}-${part()}`;
}

/** Θέσεις που απομένουν — ποτέ αρνητικές· ανενεργό πρόγραμμα = 0. */
export function remainingSpots(p: { maxSlots: number; claimedCount: number; active: boolean } | null): number {
  if (!p || !p.active) return 0;
  return Math.max(0, Math.min(FOUNDING_TOTAL, p.maxSlots) - p.claimedCount);
}

export type FounderCodeState = "ok" | "invalid" | "closed";

/** Κατάσταση κωδικού (για τον έλεγχο ΠΡΙΝ τη transaction). Ίδιο «invalid» για κάθε λόγο. */
export function founderCodeState(
  code: { active: boolean; maxClaims: number; claimedCount: number; expiresAt: Date | null } | null,
  remaining: number,
  now = new Date()
): FounderCodeState {
  if (remaining <= 0) return "closed";
  if (!code || !code.active) return "invalid";
  if (code.claimedCount >= code.maxClaims) return "invalid";
  if (code.expiresAt && code.expiresAt.getTime() <= now.getTime()) return "invalid";
  return "ok";
}

/** Πετιέται μέσα στη transaction της εγγραφής → rollback (ούτε εταιρία, ούτε θέση). */
export class FounderClaimError extends Error {
  readonly state: "invalid" | "closed";
  constructor(state: "invalid" | "closed") {
    super(`founder:${state}`);
    this.name = "FounderClaimError";
    this.state = state;
  }
}

/** Η δημόσια απάντηση του endpoint θέσεων: ΜΟΝΟ ο αριθμός. */
export const publicSpotsBody = (remaining: number) => ({ remaining: Math.max(0, Math.floor(remaining)) });
