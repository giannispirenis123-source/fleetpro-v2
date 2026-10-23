export const dynamic = "force-dynamic";
// src/app/api/onboarding/route.ts
// Onboarding μετά την εγγραφή — ΜΟΝΟ Διαχειριστής της εταιρίας. Η εταιρία από
// τη συνεδρία. «Έγινε» γράφεται μόνο για το βήμα Α· τα άλλα βγαίνουν από τα
// πραγματικά δεδομένα (οχήματα, Stripe, σελίδα, domain).

import { z } from "zod";
import { ok, badRequest, forbidden, notFound, serverError, logError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { ONBOARDING_STEPS } from "@/lib/signup/onboarding";
import { loadOnboarding, updateOnboarding } from "@/lib/signup/onboardingServer";

const patchSchema = z.object({
  step: z.enum(ONBOARDING_STEPS),
  action: z.enum(["done", "skip", "unskip"]),
});

export const GET = withPermission(
  async (_req, _session, _params, viewer) => {
    try {
      if (!viewer?.tenantId || viewer.role !== "COMPANY_ADMIN") return forbidden();
      const dto = await loadOnboarding(viewer.tenantId);
      return dto ? ok(dto) : notFound();
    } catch (error) {
      logError("Onboarding GET", error);
      return serverError();
    }
  },
  "settings.edit"
);

export const PATCH = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      if (!viewer?.tenantId || viewer.role !== "COMPANY_ADMIN") return forbidden();
      const parsed = patchSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα");
      const r = await updateOnboarding(viewer.tenantId, parsed.data.step, parsed.data.action);
      if (r === "none") return notFound();
      if (r === "invalid") return badRequest("Μη έγκυρη ενέργεια");
      const dto = await loadOnboarding(viewer.tenantId);
      return dto ? ok(dto) : notFound();
    } catch (error) {
      logError("Onboarding PATCH", error);
      return serverError();
    }
  },
  "settings.edit"
);
