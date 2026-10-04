// src/lib/contractQr.ts
// QR του link πελάτη για το αντίγραφο Α4 — SVG που φτιάχνεται στον server
// (πακέτο qrcode, χωρίς εικόνες/canvas). Server-only.

import { headers } from "next/headers";
import QRCode from "qrcode";
import { appBaseUrl, publicContractUrl } from "./contractLink";

/** NEXT_PUBLIC_APP_URL αν υπάρχει, αλλιώς το host του αιτήματος. */
export function requestBaseUrl(): string {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");
  return appBaseUrl(process.env.NEXT_PUBLIC_APP_URL, `${proto}://${host}`);
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
