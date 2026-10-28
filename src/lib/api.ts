// src/lib/api.ts
// Helper functions για API routes

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, JWTPayload } from "./auth";
import { loadViewer, type Viewer } from "./viewer";
import { readOnlyAllows, readOnlyMessage } from "./billing/core";

// Standard API responses
export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function created<T>(data: T) {
  return NextResponse.json({ success: true, data }, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function badRequest(message: string, errors?: unknown) {
  return NextResponse.json(
    { success: false, message, errors },
    { status: 400 }
  );
}

export function unauthorized(message = "Μη εξουσιοδοτημένη πρόσβαση") {
  return NextResponse.json({ success: false, message }, { status: 401 });
}

export function forbidden(message = "Δεν έχετε πρόσβαση σε αυτόν τον πόρο") {
  return NextResponse.json({ success: false, message }, { status: 403 });
}

/** 409 — η ενέργεια συγκρούεται με την τρέχουσα κατάσταση και θέλει έγκριση. */
export function conflict(message: string, conflicts?: unknown) {
  return NextResponse.json(
    { success: false, message, conflicts },
    { status: 409 }
  );
}

export function notFound(message = "Δεν βρέθηκε") {
  return NextResponse.json({ success: false, message }, { status: 404 });
}

export function serverError(message = "Εσωτερικό σφάλμα διακομιστή") {
  return NextResponse.json({ success: false, message }, { status: 500 });
}

// Middleware wrapper για protected routes
type RouteHandler = (
  req: NextRequest,
  session: JWTPayload,
  params?: Record<string, string>,
  /** Ο χρήστης όπως είναι ΤΩΡΑ στη βάση (ενεργός, εταιρία όχι σε αναστολή). */
  viewer?: Viewer
) => Promise<NextResponse>;

/**
 * Φύλακας API: έγκυρο token ΚΑΙ ο χρήστης στη βάση ενεργός, η εταιρία του όχι
 * σε αναστολή/ακυρωμένη. Ο ρόλος ελέγχεται από τη ΒΑΣΗ (όχι από το JWT), ώστε
 * απενεργοποίηση ή αλλαγή ρόλου να ισχύει αμέσως. Ένα διάβασμα χρήστη ανά αίτημα.
 */
export function withAuth(handler: RouteHandler, roles?: string[]) {
  return async (req: NextRequest, context?: { params?: Record<string, string> }) => {
    try {
      const session = await getSessionFromRequest(req);
      if (!session) return unauthorized();

      const viewer = await loadViewer(session);
      if (!viewer) return unauthorized();

      if (roles && !roles.includes(viewer.role)) {
        return forbidden();
      }

      // Συνδρομή σε «μόνο ανάγνωση» (SQL 36): καμία νέα εγγραφή — ΕΔΩ, στον
      // server, για ΚΑΘΕ route με φύλακα. Εξαιρέσεις (συνδρομή, υπάρχουσες
      // κρατήσεις/συμβόλαια): readOnlyAllows στο billing/core.ts.
      if (viewer.readOnly && !readOnlyAllows(req.method, req.nextUrl.pathname)) {
        return NextResponse.json({ success: false, message: readOnlyMessage(viewer.readOnlyReason), code: "read_only" }, { status: 403 });
      }

      return await handler(req, { ...session, role: viewer.role }, context?.params, viewer);
    } catch (error) {
      logError("API", error);
      return serverError();
    }
  };
}

/**
 * Σφάλμα στα logs ΧΩΡΙΣ προσωπικά δεδομένα: μόνο όνομα/κωδικό (π.χ. Prisma
 * P2002 και τα πεδία του constraint) — ποτέ το μήνυμα, που μπορεί να έχει
 * τιμές πελατών (email, τηλέφωνα, υπογραφές).
 */
export function logError(tag: string, error: unknown): void {
  const e = (error && typeof error === "object" ? error : {}) as { name?: unknown; code?: unknown; meta?: { target?: unknown } };
  const parts = [typeof e.name === "string" ? e.name : typeof error, typeof e.code === "string" ? e.code : null];
  const target = e.meta && Array.isArray(e.meta.target) ? e.meta.target.join(",") : null;
  console.error(`[FleetPro] ${tag}: ${parts.filter(Boolean).join(" ")}${target ? ` (${target})` : ""}`);
}

// Tenant isolation check
export function withTenant(handler: RouteHandler) {
  return withAuth(async (req, session, params) => {
    const tenantId = params?.tenantId || session.tenantId;

    if (
      session.role !== "SUPER_ADMIN" &&
      tenantId &&
      session.tenantId !== tenantId
    ) {
      return forbidden("Δεν έχετε πρόσβαση σε αυτή την εταιρία");
    }

    return handler(req, session, params);
  });
}

// Pagination helper
export function getPagination(req: NextRequest) {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "20"));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// Search helper
export function getSearch(req: NextRequest) {
  const url = new URL(req.url);
  return url.searchParams.get("q") || "";
}
