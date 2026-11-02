// src/lib/loginRedirect.ts
// Πού πάει ο χρήστης μετά τη σύνδεση — ΚΑΘΑΡΗ λογική (login API, σελίδα
// σύνδεσης, header του δημόσιου site, tests).
//
// · Ανά ρόλο: SUPER_ADMIN → /super-admin, όλοι οι άλλοι → /dashboard. Η εταιρία
//   του dashboard βγαίνει ΜΟΝΟ από το session (tenantId του χρήστη) — ποτέ από
//   το site από όπου ήρθε ο χρήστης.
// · callbackUrl: ΜΟΝΟ σχετική διαδρομή της ίδιας εφαρμογής ΚΑΙ μέσα στην
//   περιοχή του ρόλου (/super-admin… ή /dashboard…). Οτιδήποτε άλλο (απόλυτο
//   URL, «//host», «/\host», javascript:, άλλη περιοχή) → η περιοχή του ρόλου.

/** Η αρχική σελίδα κάθε ρόλου μετά τη σύνδεση. */
export function roleHome(role: string): "/super-admin" | "/dashboard" {
  return role === "SUPER_ADMIN" ? "/super-admin" : "/dashboard";
}

const AREA_RE: Record<"/super-admin" | "/dashboard", RegExp> = {
  "/super-admin": /^\/super-admin(?:[/?#]|$)/,
  "/dashboard": /^\/dashboard(?:[/?#]|$)/,
};

/**
 * Το callbackUrl ως ασφαλής σχετική διαδρομή, ή null. Δεν δέχεται τίποτα που
 * ο browser θα μπορούσε να ερμηνεύσει ως άλλο host.
 */
export function safeCallbackPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 512) return null;
  // Μόνο «/…», όχι «//…» (protocol-relative) ούτε «\» (οι browsers το κάνουν «/»).
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return null;
  // Κανένας χαρακτήρας ελέγχου / κενό (π.χ. «/\t/evil.com»).
  if (/[\u0000-\u001f\u007f\s]/.test(v)) return null;
  try {
    const base = "https://fleetpro.invalid";
    const u = new URL(v, base);
    if (u.origin !== base) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

/** Ο τελικός προορισμός μετά τη σύνδεση: το callbackUrl αν είναι ασφαλές ΚΑΙ στην περιοχή του ρόλου. */
export function loginRedirectFor(role: string, callbackUrl?: unknown): string {
  const home = roleHome(role);
  const path = safeCallbackPath(callbackUrl);
  return path && AREA_RE[home].test(path) ? path : home;
}
