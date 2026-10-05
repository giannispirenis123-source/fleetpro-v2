// src/lib/contractLink.ts
// Link πελάτη (/c/[token]) — καθαρή λογική, ΧΩΡΙΣ runtime imports, ώστε να
// τη φορτώνουν client components και τα unit tests (node:test).
//
// Κανόνες:
//  · Token: 32 κρυπτογραφικά τυχαία bytes, base64url (43 χαρακτήρες).
//  · Φτιάχνεται αυτόματα όταν το συμβόλαιο γίνει SIGNED.
//  · Ακύρωση = publicTokenRevokedAt· «Νέο link» = νέο token (το παλιό
//    παύει να ισχύει αμέσως, γιατί η αναζήτηση γίνεται με το token).
//  · Λήξη: 90 ημέρες μετά την ημερομηνία επιστροφής — υπολογίζεται, δεν
//    αποθηκεύεται.
//  · Η δημόσια σελίδα παίρνει ΜΟΝΟ ό,τι επιστρέφει το toPublicContract:
//    χωρίς εσωτερικά ids, χωρίς διπλώματα, χωρίς πληρωμή/κάρτα.

import type { ContractDTO, ContractDriver } from "./contracts";

export const PUBLIC_TOKEN_BYTES = 32;
export const LINK_DAYS_AFTER_RETURN = 90;
/** Τα signed URLs της δημόσιας σελίδας: σύντομα, νέα σε κάθε φόρτωση. */
export const PUBLIC_SIGNED_URL_SECONDS = 10 * 60;

/** base64url 32 bytes = 43 χαρακτήρες. Ό,τι άλλο απορρίπτεται πριν τη βάση. */
export const PUBLIC_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newPublicToken(): string {
  const bytes = new Uint8Array(PUBLIC_TOKEN_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Η στιγμή που λήγει το link: η ΑΡΧΗ της ημέρας μετά την 90ή ημέρα από την
 * επιστροφή (UTC). Δηλαδή ισχύει ολόκληρη η 90ή ημέρα.
 */
export function linkExpiresAt(returnDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(returnDate);
  if (!m) return null;
  return new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + LINK_DAYS_AFTER_RETURN + 1)
  );
}

export type LinkState = "none" | "active" | "revoked" | "expired";

export function linkStateOf(
  c: { publicToken: string | null; publicTokenRevokedAt: Date | string | null; returnDate: string },
  now: Date = new Date()
): LinkState {
  if (!c.publicToken) return "none";
  if (c.publicTokenRevokedAt) return "revoked";
  const expires = linkExpiresAt(c.returnDate);
  if (!expires || now.getTime() >= expires.getTime()) return "expired";
  return "active";
}

/** Τι βλέπει η φόρμα για το link. Το token μόνο όταν είναι ενεργό. */
export interface PublicLinkDTO {
  state: LinkState;
  token: string | null;
  /** ISO — πότε λήγει (υπολογισμένο). */
  expiresAt: string | null;
}

export function publicLinkDTO(
  c: { publicToken: string | null; publicTokenRevokedAt: Date | string | null; returnDate: string },
  now: Date = new Date()
): PublicLinkDTO {
  const state = linkStateOf(c, now);
  return {
    state,
    token: state === "active" ? c.publicToken : null,
    expiresAt: c.publicToken ? (linkExpiresAt(c.returnDate)?.toISOString() ?? null) : null,
  };
}

/** Βασικό URL: NEXT_PUBLIC_APP_URL αν υπάρχει, αλλιώς ό,τι δώσει ο καλών (host). */
export function appBaseUrl(envUrl: string | null | undefined, fallback: string): string {
  const env = String(envUrl ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+/i.test(env) ? env : fallback.replace(/\/+$/, "");
}

export const publicContractUrl = (base: string, token: string) =>
  `${base.replace(/\/+$/, "")}/c/${token}`;

/**
 * Το συμβόλαιο όπως το βλέπει ο ΠΕΛΑΤΗΣ. Ό,τι δεν χρειάζεται φεύγει ΕΔΩ,
 * όχι στο template: εσωτερικά ids → αύξοντες αριθμοί, κανένα δίπλωμα,
 * καμία πληρωμή/κάρτα/εγγύηση, καμία εσωτερική παρατήρηση ή κράτηση.
 */
export function toPublicContract(c: ContractDTO): ContractDTO {
  const drivers: ContractDriver[] = c.drivers.map((d, i) => ({
    id: `d${i + 1}`,
    fullName: d.fullName,
    country: d.country,
    licenseNumber: d.licenseNumber,
    licenseExpiry: d.licenseExpiry,
    birthDate: d.birthDate,
    idType: d.idType,
    idNumber: d.idNumber,
    phone: d.phone,
    email: d.email,
    address: d.address,
    signature: d.signature,
    signedAt: d.signedAt,
  }));
  const s = c.snapshot;
  return {
    id: "",
    contractNumber: c.contractNumber,
    status: c.status,
    bookingId: "",
    bookingNumber: "",
    bookingStatus: "",
    createdByName: null,
    snapshot: s
      ? {
          ...s,
          company: { ...s.company, logoUrl: null },
          booking: { ...s.booking, number: "" },
          vehicle: { ...s.vehicle, id: "" },
          // Ο πελάτης βλέπει ΜΟΝΟ την τελική τιμή — όχι ποιος/γιατί/διαφορά.
          priceOverride: s.priceOverride ? { manualTotal: s.priceOverride.manualTotal } : undefined,
        }
      : null,
    drivers,
    pickupLocation: c.pickupLocation,
    returnLocation: c.returnLocation,
    fuelPickup: c.fuelPickup,
    fuelReturn: null,
    damageMarks: c.damageMarks.map((m, i) => ({ ...m, id: `m${i + 1}` })),
    damagePhotos: c.damagePhotos.map((p, i) => ({ ...p, id: `p${i + 1}` })),
    damageNotesPickup: c.damageNotesPickup,
    damageNotesReturn: c.damageNotesReturn,
    vehicleChanges: c.vehicleChanges.map((v, i) => ({ ...v, id: `v${i + 1}`, vehicleId: "" })),
    notes: "",
    paymentMethod: null,
    depositAmount: null,
    depositMethod: null,
    paymentCard: null,
    depositCard: null,
    gdprConsent: c.gdprConsent,
    signedAt: c.signedAt,
    completedAt: c.completedAt,
    createdAt: c.createdAt,
    updatedAt: "",
    bookingExtraIds: [],
    bookingTotalNow: 0,
    extrasLock: null,
    licensePhotos: [],
    publicLink: { state: "none", token: null, expiresAt: null },
  };
}
