// src/lib/billing/routeHelpers.ts
// Κοινά των routes της συνδρομής — ΜΟΝΟ server (τα route files δέχονται μόνο
// συγκεκριμένα exports).

import { NextResponse } from "next/server";
import { badRequest, logError, serverError } from "../api";
import { publicOrigin } from "../bookingDecisionServer";
import { linkOrigin } from "../signup/signupServer";
import { BillingError, billingErrorCode } from "./billingServer";

/** Η βάση των return URLs: PLATFORM_URL αν υπάρχει, αλλιώς το origin του αιτήματος. */
export const billingOrigin = (req: Request): string => linkOrigin(publicOrigin(req));

export function billingFailure(tag: string, e: unknown): NextResponse {
  if (e instanceof BillingError) {
    return NextResponse.json({ success: false, message: e.message, code: e.code }, { status: e.status });
  }
  console.error(`[FleetPro] ${tag}: ${billingErrorCode(e)}`);
  if (e && typeof e === "object" && "type" in e) {
    // Σφάλμα του Stripe: ποτέ το μήνυμά του στον χρήστη.
    return NextResponse.json({ success: false, message: "Το Stripe δεν απάντησε. Δοκιμάστε ξανά." }, { status: 502 });
  }
  logError(tag, e);
  return serverError();
}

export const tooMany = () =>
  NextResponse.json({ success: false, message: "Πολλές προσπάθειες. Δοκιμάστε ξανά σε λίγο." }, { status: 429 });

export { badRequest };
