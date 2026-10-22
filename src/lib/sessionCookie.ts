// src/lib/sessionCookie.ts
// Το cookie της συνεδρίας — ΕΝΑ σημείο για login και αυτόματη σύνδεση μετά την
// επαλήθευση email (ίδιες ρυθμίσεις: httpOnly, secure σε production, lax, 7 ημέρες).

import type { NextResponse } from "next/server";
import { signToken, type JWTPayload } from "./auth";

export const SESSION_COOKIE = "fleetpro_token";

export async function setSessionCookie(res: NextResponse, payload: JWTPayload): Promise<void> {
  const token = await signToken(payload);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
}
