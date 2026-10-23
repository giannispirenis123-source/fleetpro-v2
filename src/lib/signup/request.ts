// src/lib/signup/request.ts
// Κοινά των routes της εγγραφής — ΜΟΝΟ server.

import { NextResponse } from "next/server";

export { isJsonRequest } from "./signup";

/** Η IP όπως στο login (πρώτη του x-forwarded-for). Στη βάση μπαίνει ΜΟΝΟ hash. */
export const clientIp = (req: Request): string =>
  (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

/** Διακόπτης OFF: ίδιο 404 με οποιαδήποτε άγνωστη διαδρομή. */
export const signupOff = () =>
  NextResponse.json({ success: false, message: "Δεν βρέθηκε" }, { status: 404, headers: { "Cache-Control": "no-store" } });

export const json = (status: number, body: Record<string, unknown>) =>
  NextResponse.json({ success: status < 400, ...body }, { status, headers: { "Cache-Control": "no-store" } });

export const notJson = () => json(415, { message: "Unsupported Media Type", code: "content_type" });
