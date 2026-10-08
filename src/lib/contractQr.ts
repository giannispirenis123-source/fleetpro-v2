// src/lib/contractQr.ts
// QR του link πελάτη για το αντίγραφο Α4 — SVG που φτιάχνεται στον server
// (πακέτο qrcode, χωρίς εικόνες/canvas). Server-only.

import { headers } from "next/headers";
import QRCode from "qrcode";
import { publicContractUrl } from "./contractLink";

/**
 * Το origin του αιτήματος (το domain που σερβίρει τη σελίδα — production ή
 * preview). Ίδια βάση με το link της φόρμας (window.location.origin).
 */
export function requestBaseUrl(): string {
  const h = headers();
  // Πίσω από proxy μπορεί να έρθουν πολλά («a, b»): μετρά το πρώτο.
  const first = (v: string | null) => v?.split(",")[0].trim() || null;
  const host = first(h.get("x-forwarded-host")) ?? first(h.get("host")) ?? "localhost:3000";
  const proto =
    first(h.get("x-forwarded-proto")) ?? (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** Το SVG του QR για ένα token (ή null σε σφάλμα — το Α4 τυπώνεται χωρίς QR). */
export async function contractQrSvg(token: string): Promise<string | null> {
  try {
    return await QRCode.toString(publicContractUrl(requestBaseUrl(), token), {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 0,
    });
  } catch {
    console.error("[FleetPro] QR: αποτυχία δημιουργίας");
    return null;
  }
}
