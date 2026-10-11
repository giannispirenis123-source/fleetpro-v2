// src/lib/cloudinary.ts
// Cloudinary — ΜΟΝΟ server-side (φωτογραφίες οχημάτων).
//
// · Το CLOUDINARY_API_SECRET ζει μόνο εδώ: ο browser παίρνει υπογραφή
//   (signature + timestamp + folder + api_key), ποτέ το secret.
// · Διαγραφή (destroy) μόνο από τον server, αφού ελεγχθεί η εταιρία.
// · Τα logs γράφουν μόνο ονόματα μεταβλητών και σύντομους κωδικούς — ποτέ
//   κλειδιά, υπογραφές ή URLs με παραμέτρους.
//
// Χρησιμοποιεί το πακέτο `cloudinary` (υπήρχε ήδη στο package.json) με
// ρυθμίσεις ανά κλήση, χωρίς global config.
//
// Server-only.

import { v2 as cloudinary } from "cloudinary";
import { ALLOWED_FORMATS_PARAM } from "./vehiclePhotos";

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

const ENV_NAMES = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const;

const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();

/** Οι ρυθμίσεις ή ποιες μεταβλητές λείπουν (μόνο ονόματα). */
export function cloudinaryConfig(
  env: Record<string, string | undefined> = process.env
): { ok: true; config: CloudinaryConfig } | { ok: false; missing: string[] } {
  // Παλιό όνομα στο .env.example: NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME (δεκτό ως εφεδρικό).
  const cloudName = clean(env.CLOUDINARY_CLOUD_NAME) || clean(env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME);
  const apiKey = clean(env.CLOUDINARY_API_KEY);
  const apiSecret = clean(env.CLOUDINARY_API_SECRET);
  const missing = ENV_NAMES.filter((_, i) => ![cloudName, apiKey, apiSecret][i]);
  if (missing.length > 0) return { ok: false, missing };
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(cloudName)) return { ok: false, missing: ["CLOUDINARY_CLOUD_NAME"] };
  return { ok: true, config: { cloudName, apiKey, apiSecret } };
}

export interface SignedUpload {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  allowedFormats: string;
  signature: string;
  uploadUrl: string;
}

/** Υπογραφή για ανέβασμα απευθείας από τον browser σε έναν συγκεκριμένο φάκελο. */
export function signVehicleUpload(config: CloudinaryConfig, folder: string, now: Date = new Date()): SignedUpload {
  const timestamp = Math.floor(now.getTime() / 1000);
  const signature = cloudinary.utils.api_sign_request(
    { allowed_formats: ALLOWED_FORMATS_PARAM, folder, timestamp },
    config.apiSecret
  );
  return {
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    timestamp,
    folder,
    allowedFormats: ALLOWED_FORMATS_PARAM,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
  };
}

/** Σύντομος, ασφαλής κωδικός σφάλματος για τα logs. */
const errorCode = (e: unknown): string => {
  const o = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
  const inner = o.error && typeof o.error === "object" ? (o.error as Record<string, unknown>) : o;
  const code = inner.http_code ?? inner.name ?? "";
  return /^[A-Za-z0-9_]{1,40}$/.test(String(code)) ? String(code) : "error";
};

/**
 * Διαγραφή μίας εικόνας. «not found» μετρά ως επιτυχία (ήδη σβησμένη).
 * Επιστρέφει false σε αποτυχία — ο καλών αποφασίζει.
 */
export async function destroyImage(config: CloudinaryConfig, publicId: string): Promise<boolean> {
  try {
    // Τα στοιχεία ανά κλήση (το πακέτο τα δέχεται, οι τύποι του όχι).
    const options = {
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      invalidate: true,
      resource_type: "image" as const,
    };
    const res = (await cloudinary.uploader.destroy(publicId, options)) as { result?: string };
    if (res?.result === "ok" || res?.result === "not found") return true;
    console.error("[FleetPro] Cloudinary destroy: απάντηση", String(res?.result ?? "").slice(0, 40));
    return false;
  } catch (e) {
    console.error("[FleetPro] Cloudinary destroy: σφάλμα", errorCode(e));
    return false;
  }
}
