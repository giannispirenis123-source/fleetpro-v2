// src/lib/users.ts
// Χρήστες εταιρίας — κοινό σημείο για API και σελίδα.

import type { User } from "@prisma/client";
import { normalizePermissions, type PermissionMap } from "./permissions";

/** Οι κατηγορίες που διαχειρίζεται ο διαχειριστής εταιρίας. */
export const MANAGED_ROLES = ["STAFF", "PARTNER"] as const;
export type ManagedRole = (typeof MANAGED_ROLES)[number];

/** Όλοι οι ρόλοι που μπορεί να έχει χρήστης εταιρίας. */
export const COMPANY_ROLES = ["COMPANY_ADMIN", "STAFF", "PARTNER"] as const;

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  /** Κενό για COMPANY_ADMIN: τα έχει όλα εξ ορισμού. */
  permissions: PermissionMap;
  /** Πόσα δικαιώματα έχει — για τη σύνοψη στην κάρτα. */
  permissionCount: number;
  lastLoginAt: string | null;
  createdAt: string;
}

type UserRow = Pick<
  User,
  | "id"
  | "name"
  | "email"
  | "phone"
  | "role"
  | "isActive"
  | "permissions"
  | "lastLoginAt"
  | "createdAt"
>;

export function toUserDTO(u: UserRow): UserDTO {
  const permissions =
    u.role === "COMPANY_ADMIN" ? {} : normalizePermissions(u.permissions);

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    isActive: u.isActive,
    permissions,
    permissionCount: Object.keys(permissions).length,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

export const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  permissions: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/** Ίδια rounds με prisma/seed.ts, POST /api/users και το reset κωδικού. */
export const BCRYPT_ROUNDS = 12;
