export const dynamic = "force-dynamic";
// src/app/api/super-admin/feedback/route.ts
// GET /api/super-admin/feedback — οι απαντήσεις «Πες μας τη γνώμη σου» (μόνο Super Admin).

import { withAuth, ok, serverError, logError } from "@/lib/api";
import { db } from "@/lib/db";
import type { FeedbackDTO } from "@/lib/feedback";

export const GET = withAuth(async () => {
  try {
    const rows = await db.tenantFeedback.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { tenant: { select: { name: true } }, user: { select: { name: true } } },
    });
    const items: FeedbackDTO[] = rows.map((r) => ({
      id: r.id,
      tenantName: r.tenant?.name ?? null,
      userName: r.user?.name ?? null,
      helpedMost: r.helpedMost,
      missing: r.missing,
      vehicleCount: r.vehicleCount,
      createdAt: r.createdAt.toISOString(),
    }));
    return ok({ items });
  } catch (error) {
    logError("super-admin/feedback", error);
    return serverError();
  }
}, ["SUPER_ADMIN"]);
