export const dynamic = "force-dynamic";
// src/app/api/auth/me/route.ts

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { logError, ok, serverError, unauthorized } from "@/lib/api";
import { loadViewer } from "@/lib/viewer";
import { getSessionFromRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return unauthorized();
    // Ενεργός χρήστης, εταιρία όχι σε αναστολή — ίδιος κανόνας με κάθε API.
    if (!(await loadViewer(session))) return unauthorized();

    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        tenantId: true,
        phone: true,
        avatarUrl: true,
        permissions: true,
        lastLoginAt: true,
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            brandColor: true,
            logoUrl: true,
            plan: true,
            status: true,
          },
        },
      },
    });

    if (!user) return unauthorized();
    return ok(user);
  } catch (error) {
    logError("auth/me", error);
    return serverError();
  }
}
