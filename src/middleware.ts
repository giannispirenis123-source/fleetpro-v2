// src/middleware.ts
// Auth middleware — προστασία routes + tenant routing

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

// Routes που δεν χρειάζονται auth
const PUBLIC_ROUTES = ["/login", "/api/auth/login"];

// Routes μόνο για Super Admin
const SUPER_ADMIN_ROUTES = ["/super-admin"];

// Routes για Company Admin+
const ADMIN_ROUTES = [
  "/dashboard/settings",
  "/dashboard/users",
  "/dashboard/finance",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Επιτρέπουμε public routes
  if (PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // Επιτρέπουμε API routes (έχουν δικό τους auth)
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Έλεγχος token
  const token = req.cookies.get("fleetpro_token")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const session = await verifyToken(token);

  if (!session) {
    const response = NextResponse.redirect(new URL("/login", req.url));
    response.cookies.delete("fleetpro_token");
    return response;
  }

  // Super Admin only routes
  if (
    SUPER_ADMIN_ROUTES.some((r) => pathname.startsWith(r)) &&
    session.role !== "SUPER_ADMIN"
  ) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Admin only routes
  if (
    ADMIN_ROUTES.some((r) => pathname.startsWith(r)) &&
    session.role === "PARTNER"
  ) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Redirect Super Admin από dashboard στο super-admin
  if (pathname === "/dashboard" && session.role === "SUPER_ADMIN") {
    return NextResponse.redirect(new URL("/super-admin", req.url));
  }

  // Redirect στο login αν δεν είναι Super Admin και πάει σε /super-admin
  if (pathname.startsWith("/super-admin") && session.role !== "SUPER_ADMIN") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg).*)",
  ],
};
