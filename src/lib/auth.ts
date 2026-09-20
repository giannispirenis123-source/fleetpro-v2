// src/lib/auth.ts
// JWT authentication για FleetPro multi-tenant

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { normalizeLocale, type Locale } from "./i18n/locale";

// Το JWT secret ΠΡΕΠΕΙ να ορίζεται στο environment.
// Δεν υπάρχει προεπιλογή: χωρίς αυτό η εφαρμογή σταματά με καθαρό σφάλμα.
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set. Ορίστε τη μεταβλητή περιβάλλοντος JWT_SECRET " +
        "(τουλάχιστον 32 χαρακτήρες) πριν εκκινήσετε την εφαρμογή."
    );
  }

  return new TextEncoder().encode(secret);
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  tenantId: string | null;
  tenantSlug: string | null;
  name: string;
  locale: Locale;
}

// Δημιουργία JWT token
export async function signToken(payload: JWTPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
}

// Επαλήθευση JWT token
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  // Εκτός του try: αν λείπει το JWT_SECRET πρέπει να φανεί το σφάλμα,
  // όχι να θεωρηθεί απλώς «άκυρο token».
  const secret = getJwtSecret();

  try {
    const { payload } = await jwtVerify(token, secret);
    const claims = payload as unknown as JWTPayload;

    // Τα tokens που εκδόθηκαν πριν την προσθήκη της γλώσσας δεν έχουν locale.
    // Κανονικοποιούμε εδώ, ώστε κάθε session να έχει πάντα έγκυρη τιμή.
    return { ...claims, locale: normalizeLocale(claims.locale) };
  } catch {
    return null;
  }
}

// Ανάγνωση session από cookies (server components)
export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = cookies();
  const token = cookieStore.get("fleetpro_token")?.value;
  if (!token) return null;
  return verifyToken(token);
}

// Ανάγνωση session από request headers (API routes)
export async function getSessionFromRequest(
  req: NextRequest
): Promise<JWTPayload | null> {
  const token =
    req.cookies.get("fleetpro_token")?.value ||
    req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  return verifyToken(token);
}

// Έλεγχος αν ο χρήστης είναι Super Admin
export function isSuperAdmin(session: JWTPayload): boolean {
  return session.role === "SUPER_ADMIN";
}

// Έλεγχος αν ο χρήστης είναι Company Admin
export function isCompanyAdmin(session: JWTPayload): boolean {
  return session.role === "COMPANY_ADMIN";
}

// Έλεγχος αν ο χρήστης ανήκει στον tenant
export function belongsToTenant(
  session: JWTPayload,
  tenantId: string
): boolean {
  if (isSuperAdmin(session)) return true;
  return session.tenantId === tenantId;
}

// Permissions helper
export function hasPermission(
  session: JWTPayload,
  permissions: Record<string, boolean>,
  permission: string
): boolean {
  if (isSuperAdmin(session) || isCompanyAdmin(session)) return true;
  return permissions[permission] === true;
}
