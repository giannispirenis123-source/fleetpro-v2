export const dynamic = "force-dynamic";
// src/app/api/auth/logout/route.ts

import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete("fleetpro_token");
  return response;
}

// GET /api/auth/logout — αποσύνδεση με απλό link (π.χ. από κινητό) → /login.
export async function GET(req: Request) {
  const response = NextResponse.redirect(new URL("/login", req.url));
  response.cookies.delete("fleetpro_token");
  return response;
}
