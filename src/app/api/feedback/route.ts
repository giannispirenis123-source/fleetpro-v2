export const dynamic = "force-dynamic";
// src/app/api/feedback/route.ts
// POST /api/feedback — «Πες μας τη γνώμη σου» (προαιρετικό). Κάθε ενεργός
// χρήστης εταιρίας· εταιρία και χρήστης ΠΑΝΤΑ από το session. Επιτρέπεται και
// σε «μόνο ανάγνωση». Όριο ανά χρήστη.

import { withAuth, created, badRequest, forbidden, serverError, logError } from "@/lib/api";
import { db } from "@/lib/db";
import { feedbackSchema } from "@/lib/feedback";
import { hitLimit, LIMITS } from "@/lib/public/rateLimit";
import { dbCounterStore } from "@/lib/public/rateLimitStore";
import { tooMany } from "@/lib/billing/routeHelpers";

export const POST = withAuth(async (req, session, _params, viewer) => {
  try {
    if (!viewer?.tenantId) return forbidden();
    const parsed = feedbackSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest("Συμπληρώστε τουλάχιστον μία απάντηση.");
    if (!(await hitLimit(dbCounterStore, LIMITS.feedbackPerUser, viewer.userId))) return tooMany();
    const f = await db.tenantFeedback.create({
      data: {
        tenantId: viewer.tenantId,
        userId: viewer.userId,
        helpedMost: parsed.data.helpedMost ?? null,
        missing: parsed.data.missing ?? null,
        vehicleCount: parsed.data.vehicleCount ?? null,
      },
      select: { id: true },
    });
    return created({ id: f.id });
  } catch (error) {
    logError("feedback", error);
    return serverError();
  }
}, ["COMPANY_ADMIN", "STAFF", "PARTNER"]);
