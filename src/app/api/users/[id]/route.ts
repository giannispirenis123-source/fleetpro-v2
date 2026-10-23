export const dynamic = "force-dynamic";
// src/app/api/users/[id]/route.ts
// DELETE /api/users/[id] — ΟΡΙΣΤΙΚΗ διαγραφή χρήστη της εταιρίας (SQL 35).
// Φύλακας στον server: μόνο ενεργός Διαχειριστής της ΙΔΙΑΣ εταιρίας (ρόλος από
// τη βάση). Staff/Partner → 403 · άλλη εταιρία → 404 · όχι ο εαυτός · όχι ο
// τελευταίος Διαχειριστής. Η «Απενεργοποίηση» μένει στο /api/company-users/[id].
// Λογική: src/lib/userDelete.ts (κανόνες: canHardDelete στο adminRole.ts).

import { withAuth, ok, badRequest, forbidden, notFound, serverError, logError } from "@/lib/api";
import { hardDeleteCompanyUser } from "@/lib/userDelete";

export const DELETE = withAuth(async (_req, _session, params, viewer) => {
  try {
    if (!viewer) return forbidden();
    const r = await hardDeleteCompanyUser({ id: viewer.userId, role: viewer.role, tenantId: viewer.tenantId }, params!.id);
    if (r.ok) return ok({ deleted: true });
    return r.status === 404 ? notFound(r.message) : r.status === 403 ? forbidden(r.message) : badRequest(r.message);
  } catch (error) {
    logError("Οριστική διαγραφή χρήστη", error);
    return serverError();
  }
});
