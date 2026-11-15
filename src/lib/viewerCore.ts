// src/lib/viewerCore.ts
// Ποιος περνά τον φύλακα — ΚΑΘΑΡΗ λογική (χωρίς βάση), για server και tests.
//
// · Ανενεργός χρήστης → όχι.
// · Χρήστης εταιρίας σε αναστολή ή ακυρωμένης → όχι (και με ζωντανό cookie).
// · Το token πρέπει να αντιστοιχεί στον ΙΔΙΟ χρήστη/εταιρία με τη βάση.
// · Email που περιμένει επαλήθευση (emailVerifiedAt = null, μόνο από /signup)
//   → όχι (ούτε dashboard ούτε API).
// · Σύνδεση που εκδόθηκε ΠΡΙΝ από την τελευταία αλλαγή κωδικού → όχι (SQL 41).
// Ο ρόλος και τα δικαιώματα έρχονται ΠΑΝΤΑ από τη βάση, όχι από το JWT.

export const BLOCKED_TENANT_STATUSES = ["SUSPENDED", "CANCELLED"] as const;

export const isTenantBlocked = (status: string | null | undefined): boolean =>
  typeof status === "string" && (BLOCKED_TENANT_STATUSES as readonly string[]).includes(status);

export interface ViewerRow {
  id: string;
  role: string;
  tenantId: string | null;
  isActive: boolean;
  /** null = περιμένει επαλήθευση email. undefined = δεν διαβάστηκε (παλιοί καλούντες). */
  emailVerifiedAt?: Date | null;
  permissions: unknown;
  tenant: { status: string } | null;
  /** Πότε άλλαξε τελευταία ο κωδικός (SQL 41). null/undefined = ποτέ. */
  passwordChangedAt?: Date | null;
}

/**
 * Η στιγμή αλλαγής κωδικού που γράφεται στη βάση: ΣΤΡΟΓΓΥΛΕΜΕΝΗ προς τα κάτω
 * σε δευτερόλεπτο, όπως το iat του JWT — ώστε η σύνδεση που εκδίδεται αμέσως
 * μετά (ίδιο δευτερόλεπτο) να μην απορρίπτεται.
 */
export const passwordChangeStamp = (now: Date = new Date()): Date => new Date(Math.floor(now.getTime() / 1000) * 1000);

/**
 * Το token εκδόθηκε ΠΡΙΝ από την τελευταία αλλαγή κωδικού; Τότε δεν ισχύει
 * πια (κλεμμένο cookie, ξεχασμένη συσκευή). Token χωρίς iat με αλλαγμένο
 * κωδικό → επίσης όχι.
 */
export function issuedBeforePasswordChange(iat: unknown, passwordChangedAt: Date | null | undefined): boolean {
  if (!passwordChangedAt) return false;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return true;
  return iat < Math.floor(passwordChangedAt.getTime() / 1000);
}

/** null = δεν περνά. Αλλιώς ο χρήστης όπως είναι ΤΩΡΑ στη βάση. */
export function acceptViewerRow(
  row: ViewerRow | null,
  session: { userId: string; tenantId?: string | null; iat?: number }
): ViewerRow | null {
  if (!row || !row.isActive) return null;
  if (issuedBeforePasswordChange(session.iat, row.passwordChangedAt)) return null;
  if (row.emailVerifiedAt === null) return null;
  if (row.id !== session.userId) return null;
  // Το token γράφτηκε για άλλη εταιρία από αυτή που έχει τώρα ο χρήστης.
  if ((session.tenantId ?? null) !== (row.tenantId ?? null)) return null;
  if (row.tenantId && isTenantBlocked(row.tenant?.status)) return null;
  return row;
}
