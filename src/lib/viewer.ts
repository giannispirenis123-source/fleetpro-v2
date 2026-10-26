// src/lib/viewer.ts
// Ο χρήστης όπως είναι ΤΩΡΑ στη βάση — ΜΟΝΟ server. Ένα ερώτημα: ρόλος,
// δικαιώματα, isActive και η κατάσταση της εταιρίας (αναστολή/ακύρωση).

import { db } from "./db";
import type { JWTPayload } from "./auth";
import { normalizePermissions, roleHasAll, type PermissionMap } from "./permissions";
import { acceptViewerRow } from "./viewerCore";
import { billingAccess, billingNow, testClocksEnabled } from "./billing/core";

export interface Viewer {
  userId: string;
  role: string;
  tenantId: string | null;
  permissions: PermissionMap;
  /** Η εταιρία είναι σε «μόνο ανάγνωση» λόγω συνδρομής (SQL 36) — βλ. billing/core.ts. */
  readOnly?: boolean;
}

export async function loadViewer(session: JWTPayload): Promise<Viewer | null> {
  const row = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      role: true,
      tenantId: true,
      isActive: true,
      emailVerifiedAt: true,
      permissions: true,
      tenant: {
        select: { status: true, billingStatus: true, trialEndsAt: true, pastDueSince: true, stripeTestClockId: true, billingClockAt: true },
      },
    },
  });
  const user = acceptViewerRow(row, session);
  if (!user) return null;
  return {
    userId: user.id,
    role: user.role,
    tenantId: user.tenantId,
    permissions: roleHasAll(user.role) ? {} : normalizePermissions(user.permissions),
    // Ώρα: του test clock της εταιρίας μόνο στο Preview με ενεργά clocks (SQL 37).
    readOnly: row?.tenant
      ? billingAccess(row.tenant, billingNow(row.tenant, new Date(), testClocksEnabled(process.env))).mode === "read_only"
      : false,
  };
}
