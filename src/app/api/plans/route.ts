export const dynamic = "force-dynamic";
// src/app/api/plans/route.ts
// GET /api/plans — τα πακέτα (entitlements) για τα selects του Super Admin.
// Μόνο ανάγνωση: οι τιμές (modules/limits) αλλάζουν στη βάση (SQL), χωρίς deploy.

import { db } from "@/lib/db";
import { ok, serverError, withAuth, logError } from "@/lib/api";

export const GET = withAuth(async () => {
  try {
    const plans = await db.plan.findMany({
      orderBy: { key: "asc" },
      select: { key: true, name: true, modules: true, limits: true, active: true },
    });
    return ok({ plans });
  } catch (error) {
    logError("plans", error);
    return serverError();
  }
}, ["SUPER_ADMIN"]);
