// src/lib/auth.ts
// JWT authentication για FleetPro multi-tenant

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret-change-in-production"
);

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  tenantId: string | null;
  tenantSlug: string | null;
  name: string;
}

// Δημιουργία JWT token
export async function signToken(payload: JWTPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

// Επαλήθευση JWT token
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
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
