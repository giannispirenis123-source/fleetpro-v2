// src/middleware.ts
// Auth middleware — προστασία routes + tenant routing

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

// Routes που δεν χρειάζονται auth
const PUBLIC_ROUTES = ["/login", "/api/auth/login"];

// Routes μόνο για Super Admin
const SUPER_ADMIN_ROUTES = ["/super-admin"];

// Routes για Company Admin+
// (Τα Οικονομικά ΔΕΝ είναι εδώ: τα φυλάει το δικαίωμα finance.view μέσω
// pageGuard/withPermission, όχι ο ρόλος.)
const ADMIN_ROUTES = [
  "/dashboard/settings",
  "/dashboard/users",
];

// Η σελίδα πελάτη /c/<token>: ΜΟΝΟ αυτή η διαδρομή (ακριβώς ένα τμήμα,
// χαρακτήρες base64url) είναι ελεύθερη χωρίς login.
const PUBLIC_CONTRACT_RE = /^\/c\/[A-Za-z0-9_-]{1,128}$/;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_CONTRACT_RE.test(pathname)) {
    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.headers.set("Cache-Control", "no-store, max-age=0");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  }

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
