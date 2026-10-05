// src/lib/adminRole.ts
// Κανόνες για τον ρόλο «Διαχειριστής» (COMPANY_ADMIN) — καθαρή λογική,
// ΧΩΡΙΣ runtime imports, ώστε να τη φορτώνουν τα API, η σελίδα και τα
// unit tests (node:test). Ο server την εφαρμόζει ΠΑΝΤΑ· το UI απλώς κρύβει
// ό,τι θα απορριπτόταν.
//
// · Πολλοί διαχειριστές ανά εταιρία επιτρέπονται.
// · Μόνο ενεργός COMPANY_ADMIN της ΙΔΙΑΣ εταιρίας δίνει ή αφαιρεί τον ρόλο
//   (ποτέ SUPER_ADMIN, ποτέ STAFF/PARTNER, ακόμη κι αν έχουν users.*).
// · Προαγωγή μόνο από Προσωπικό (STAFF) — ή απευθείας στη δημιουργία.
// · Κανείς δεν αλλάζει τον δικό του ρόλο.
// · Ο ΤΕΛΕΥΤΑΙΟΣ ενεργός διαχειριστής δεν υποβιβάζεται ούτε απενεργοποιείται.

export const ADMIN_ROLE = "COMPANY_ADMIN";
/** Οι ρόλοι που δίνονται από τη σελίδα Χρήστες. */
export const ASSIGNABLE_ROLES = ["COMPANY_ADMIN", "STAFF", "PARTNER"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export interface RoleActor {
  id: string;
  /** Ο ρόλος ΟΠΩΣ ΕΙΝΑΙ ΣΤΗ ΒΑΣΗ (όχι από το JWT). */
  role: string;
  tenantId: string | null;
}

export interface RoleTarget {
  id: string;
  role: string;
  tenantId: string | null;
  isActive: boolean;
}

export type RoleDecision = { ok: true } | { ok: false; status: 400 | 403 | 404; message: string };

const ALLOW: RoleDecision = { ok: true };
const deny = (status: 400 | 403 | 404, message: string): RoleDecision => ({ ok: false, status, message });

export const MSG = {
  notFound: "Ο χρήστης δεν βρέθηκε",
  onlyAdmin: "Μόνο διαχειριστής της εταιρίας δίνει ή αφαιρεί τον ρόλο Διαχειριστή",
  self: "Δεν μπορείτε να αλλάξετε τα δικά σας δικαιώματα ή τον ρόλο σας",
  lastAdmin: "Η εταιρία πρέπει να έχει τουλάχιστον έναν ενεργό διαχειριστή",
  onlyFromStaff: "Διαχειριστής γίνεται μόνο μέλος του Προσωπικού",
  adminAccount: "Τον λογαριασμό διαχειριστή τον αλλάζει μόνο διαχειριστής της εταιρίας",
} as const;

/** Ενεργός διαχειριστής εταιρίας (όχι Super Admin, με εταιρία). */
export const isCompanyAdmin = (a: RoleActor) => a.role === ADMIN_ROLE && Boolean(a.tenantId);

/** Δημιουργία χρήστη με ρόλο `role`. */
export function canCreateWithRole(actor: RoleActor, role: string): RoleDecision {
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) return deny(400, "Μη έγκυρος ρόλος");
  if (role === ADMIN_ROLE && !isCompanyAdmin(actor)) return deny(403, MSG.onlyAdmin);
  return ALLOW;
}

/**
 * Αλλαγή ρόλου ή/και ενεργής κατάστασης ενός χρήστη.
 * `otherActiveAdmins`: πόσοι ΑΛΛΟΙ ενεργοί διαχειριστές έχει η εταιρία.
 */
export function canChangeRole(
  actor: RoleActor,
  target: RoleTarget | null,
  change: { role?: string; isActive?: boolean },
  otherActiveAdmins: number
): RoleDecision {
  // Ξένη εταιρία = δεν υπάρχει (ούτε μαρτυρούμε ότι υπάρχει).
  if (!target || !actor.tenantId || target.tenantId !== actor.tenantId) return deny(404, MSG.notFound);

  const roleChanges = change.role !== undefined && change.role !== target.role;
  if (!roleChanges && change.isActive === undefined) return ALLOW;

  if (target.id === actor.id) return deny(403, MSG.self);
  if (change.role !== undefined && !(ASSIGNABLE_ROLES as readonly string[]).includes(change.role)) {
    return deny(400, "Μη έγκυρος ρόλος");
  }

  const wasAdmin = target.role === ADMIN_ROLE;
  const becomesAdmin = roleChanges && change.role === ADMIN_ROLE;
  const losesAdmin = wasAdmin && (roleChanges || change.isActive === false);

  // Οτιδήποτε αγγίζει διαχειριστή (προαγωγή, υποβιβασμός, απενεργοποίηση
  // ή ενεργοποίηση) → μόνο διαχειριστής.
  if ((wasAdmin || becomesAdmin) && !isCompanyAdmin(actor)) return deny(403, MSG.onlyAdmin);
  if (becomesAdmin && target.role !== "STAFF") return deny(400, MSG.onlyFromStaff);
  if (losesAdmin && target.isActive && otherActiveAdmins === 0) return deny(400, MSG.lastAdmin);
  return ALLOW;
}

/** Απενεργοποίηση (DELETE): ίδιοι κανόνες + όχι ο εαυτός. */
export function canDeactivate(actor: RoleActor, target: RoleTarget | null, otherActiveAdmins: number): RoleDecision {
  if (target && target.id === actor.id && target.tenantId === actor.tenantId) {
    return deny(403, "Δεν μπορείτε να διαγράψετε τον εαυτό σας");
  }
  return canChangeRole(actor, target, { isActive: false }, otherActiveAdmins);
}
