export const dynamic = "force-dynamic";
// src/app/api/settings/email-sender/route.ts
// Ρυθμίσεις → «Αποστολέας email»: όνομα και διεύθυνση αποστολής της εταιρίας
// και η (χειροκίνητη) ένδειξη ότι το domain επαληθεύτηκε στο Resend.
// ΜΟΝΟ Διαχειριστής της εταιρίας (ρόλος από τη βάση) — η εταιρία ΠΑΝΤΑ από τη
// συνεδρία. Καμία κλήση στο Resend API.

import { badRequest, forbidden, ok, serverError } from "@/lib/api";
import { withPermission, type Viewer } from "@/lib/authz";
import { emailSenderSchema } from "@/lib/emailSender";
import { loadEmailSender, saveEmailSender } from "@/lib/emailSenderServer";

const adminTenant = (viewer: Viewer | undefined): string | null =>
  viewer?.tenantId && viewer.role === "COMPANY_ADMIN" ? viewer.tenantId : null;

const ONLY_ADMIN = "Μόνο ο Διαχειριστής της εταιρίας έχει πρόσβαση";

// GET /api/settings/email-sender
export const GET = withPermission(async (_req, _session, _params, viewer) => {
  try {
    const tenantId = adminTenant(viewer);
    if (!tenantId) return forbidden(ONLY_ADMIN);
    return ok(await loadEmailSender(tenantId));
  } catch (error) {
    console.error("[FleetPro] email-sender GET:", error instanceof Error ? error.name : "");
    return serverError();
  }
}, "settings.edit");

// PUT /api/settings/email-sender — { name, address, verified }
export const PUT = withPermission(async (req, _session, _params, viewer) => {
  try {
    const tenantId = adminTenant(viewer);
    if (!tenantId) return forbidden(ONLY_ADMIN);
    const parsed = emailSenderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? "Μη έγκυρα δεδομένα");
    await saveEmailSender(tenantId, parsed.data);
    return ok(await loadEmailSender(tenantId));
  } catch (error) {
    console.error("[FleetPro] email-sender PUT:", error instanceof Error ? error.name : "");
    return serverError();
  }
}, "settings.edit");
