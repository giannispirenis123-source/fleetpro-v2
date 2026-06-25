// src/lib/api.ts
// Helper functions για API routes

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, JWTPayload } from "./auth";

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
  params?: Record<string, string>
) => Promise<NextResponse>;

export function withAuth(handler: RouteHandler, roles?: string[]) {
  return async (req: NextRequest, context?: { params?: Record<string, string> }) => {
    try {
      const session = await getSessionFromRequest(req);

      if (!session) {
        return unauthorized();
      }

      if (roles && !roles.includes(session.role)) {
        return forbidden();
      }

      return handler(req, session, context?.params);
    } catch (error) {
      console.error("API Error:", error);
      return serverError();
    }
  };
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
