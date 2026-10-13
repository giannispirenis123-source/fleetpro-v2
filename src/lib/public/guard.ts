// src/lib/public/guard.ts
// Φύλακας για ΚΑΘΕ API ρυθμίσεων του δημόσιου site — ΜΟΝΟ server.
//
// Ίδιος έλεγχος με το «Η σελίδα μου» (storefrontAccess): Διαχειριστής εταιρίας
// (ρόλος από τη βάση) ΚΑΙ πακέτο με publicSite. Ο handler παίρνει το
// companyId της ΣΥΝΕΔΡΙΑΣ — ποτέ από το body/URL του browser.

import type { NextRequest, NextResponse } from "next/server";
import { forbidden } from "../api";
import { withPermission } from "../authz";
import { storefrontAccess } from "../storefront/admin";

export function withPublicSite(
  handler: (req: NextRequest, companyId: string, params: Record<string, string>) => Promise<NextResponse>
) {
  return withPermission(async (req, _session, params, viewer) => {
    const access = await storefrontAccess(viewer);
    if (!access.ok) return forbidden(access.message);
    return handler(req, access.companyId, params ?? {});
  }, "settings.edit");
}
