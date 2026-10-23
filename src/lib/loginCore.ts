// src/lib/loginCore.ts
// Η απόφαση της σύνδεσης — ΚΑΘΑΡΗ λογική (για τα tests).
//
// · Ο κωδικός ελέγχεται ΠΡΩΤΑ: χωρίς σωστό κωδικό κανείς δεν μαθαίνει αν ο
//   λογαριασμός υπάρχει, είναι ανενεργός ή η εταιρία σε αναστολή.
// · Εταιρία σε αναστολή Ή ακυρωμένη → όχι σύνδεση (ίδιος κανόνας με τον φύλακα).
// · Email που περιμένει επαλήθευση (μόνο λογαριασμοί από /signup, SQL 34) →
//   όχι σύνδεση. Φαίνεται ΜΟΝΟ με σωστό κωδικό (καμία αποκάλυψη λογαριασμών).

import { isTenantBlocked } from "./viewerCore";

export const LOGIN_MSG = {
  wrong: "Λάθος email ή κωδικός",
  inactive: "Ο λογαριασμός σας έχει απενεργοποιηθεί",
  suspended: "Η εταιρία σας έχει ανασταλεί. Επικοινωνήστε με την υποστήριξη.",
  tooMany: "Πολλές προσπάθειες σύνδεσης. Δοκιμάστε ξανά σε λίγα λεπτά.",
  unverified: "Επιβεβαιώστε πρώτα το email σας από τον σύνδεσμο που σας στείλαμε.",
} as const;

export function loginDecision(
  user: { isActive: boolean; emailVerifiedAt?: Date | null; tenant: { status: string } | null } | null,
  passwordOk: boolean
): { ok: true } | { ok: false; message: string; code?: "unverified" } {
  if (!user || !passwordOk) return { ok: false, message: LOGIN_MSG.wrong };
  if (!user.isActive) return { ok: false, message: LOGIN_MSG.inactive };
  if (user.emailVerifiedAt === null) return { ok: false, message: LOGIN_MSG.unverified, code: "unverified" };
  if (user.tenant && isTenantBlocked(user.tenant.status)) return { ok: false, message: LOGIN_MSG.suspended };
  return { ok: true };
}
