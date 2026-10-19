// src/lib/loginCore.ts
// Η απόφαση της σύνδεσης — ΚΑΘΑΡΗ λογική (για τα tests).
//
// · Ο κωδικός ελέγχεται ΠΡΩΤΑ: χωρίς σωστό κωδικό κανείς δεν μαθαίνει αν ο
//   λογαριασμός υπάρχει, είναι ανενεργός ή η εταιρία σε αναστολή.
// · Εταιρία σε αναστολή Ή ακυρωμένη → όχι σύνδεση (ίδιος κανόνας με τον φύλακα).

import { isTenantBlocked } from "./viewerCore";

export const LOGIN_MSG = {
  wrong: "Λάθος email ή κωδικός",
  inactive: "Ο λογαριασμός σας έχει απενεργοποιηθεί",
  suspended: "Η εταιρία σας έχει ανασταλεί. Επικοινωνήστε με την υποστήριξη.",
  tooMany: "Πολλές προσπάθειες σύνδεσης. Δοκιμάστε ξανά σε λίγα λεπτά.",
} as const;

export function loginDecision(
  user: { isActive: boolean; tenant: { status: string } | null } | null,
  passwordOk: boolean
): { ok: true } | { ok: false; message: string } {
  if (!user || !passwordOk) return { ok: false, message: LOGIN_MSG.wrong };
  if (!user.isActive) return { ok: false, message: LOGIN_MSG.inactive };
  if (user.tenant && isTenantBlocked(user.tenant.status)) return { ok: false, message: LOGIN_MSG.suspended };
  return { ok: true };
}
