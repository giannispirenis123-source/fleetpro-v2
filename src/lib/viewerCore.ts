// src/lib/viewerCore.ts
// Ποιος περνά τον φύλακα — ΚΑΘΑΡΗ λογική (χωρίς βάση), για server και tests.
//
// · Ανενεργός χρήστης → όχι.
// · Χρήστης εταιρίας σε αναστολή ή ακυρωμένης → όχι (και με ζωντανό cookie).
// · Το token πρέπει να αντιστοιχεί στον ΙΔΙΟ χρήστη/εταιρία με τη βάση.
// · Email που περιμένει επαλήθευση (emailVerifiedAt = null, μόνο από /signup)
//   → όχι (ούτε dashboard ούτε API).
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
}

/** null = δεν περνά. Αλλιώς ο χρήστης όπως είναι ΤΩΡΑ στη βάση. */
export function acceptViewerRow(
  row: ViewerRow | null,
  session: { userId: string; tenantId?: string | null }
): ViewerRow | null {
  if (!row || !row.isActive) return null;
  if (row.emailVerifiedAt === null) return null;
  if (row.id !== session.userId) return null;
  // Το token γράφτηκε για άλλη εταιρία από αυτή που έχει τώρα ο χρήστης.
  if ((session.tenantId ?? null) !== (row.tenantId ?? null)) return null;
  if (row.tenantId && isTenantBlocked(row.tenant?.status)) return null;
  return row;
}
