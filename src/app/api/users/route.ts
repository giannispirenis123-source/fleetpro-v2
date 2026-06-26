export const dynamic = "force-dynamic";
// src/app/api/users/route.ts
// Διαχείριση χρηστών (Company Admin + Super Admin)

import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  withAuth,
  ok,
  created,
  badRequest,
  forbidden,
  serverError,
  getPagination,
} from "@/lib/api";

const createUserSchema = z.object({
  name: z.string().min(2, "Απαιτείται όνομα"),
  email: z.string().email("Μη έγκυρο email"),
  password: z.string().min(8, "Τουλάχιστον 8 χαρακτήρες"),
  role: z.enum(["COMPANY_ADMIN", "STAFF", "PARTNER"]),
  phone: z.string().optional(),
  // Granular permissions
  permissions: z
    .object({
      viewBookings: z.boolean().default(true),
      manageBookings: z.boolean().default(false),
      viewContracts: z.boolean().default(false),
      manageContracts: z.boolean().default(false),
      viewInvoices: z.boolean().default(false),
      manageInvoices: z.boolean().default(false),
      viewFleet: z.boolean().default(true),
      manageFleet: z.boolean().default(false),
      viewService: z.boolean().default(false),
      manageService: z.boolean().default(false),
      viewCustomers: z.boolean().default(false),
      manageCustomers: z.boolean().default(false),
      viewReports: z.boolean().default(false),
      viewFinance: z.boolean().default(false),
      viewCalendar: z.boolean().default(true),
      manageDamages: z.boolean().default(false),
      manageDiscounts: z.boolean().default(false),
    })
    .optional(),
});

// GET /api/users — Λίστα χρηστών του tenant
export const GET = withAuth(
  async (req, session) => {
    try {
      const { skip, limit } = getPagination(req);

      // Super Admin βλέπει όλους, Company Admin βλέπει μόνο τους δικούς του
      const where =
        session.role === "SUPER_ADMIN"
          ? {}
          : { tenantId: session.tenantId! };

      const [users, total] = await Promise.all([
        db.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            phone: true,
            avatarUrl: true,
            isActive: true,
            permissions: true,
            lastLoginAt: true,
            createdAt: true,
            tenant: {
              select: { id: true, name: true },
            },
          },
        }),
        db.user.count({ where }),
      ]);

      return ok({ users, total });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["SUPER_ADMIN", "COMPANY_ADMIN"]
);

// POST /api/users — Δημιουργία νέου χρήστη
export const POST = withAuth(
  async (req, session) => {
    try {
      const body = await req.json();
      const parsed = createUserSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const { name, email, password, role, phone, permissions } = parsed.data;

      // Company Admin δεν μπορεί να δημιουργήσει SUPER_ADMIN
      if (session.role === "COMPANY_ADMIN" && role === "COMPANY_ADMIN") {
        return forbidden("Δεν μπορείτε να δημιουργήσετε άλλον διαχειριστή");
      }

      // Έλεγχος duplicate email
      const existing = await db.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existing) {
        return badRequest("Το email χρησιμοποιείται ήδη");
      }

      const passwordHash = await bcrypt.hash(password, 12);

      // Default permissions based on role
      const defaultPermissions = getDefaultPermissions(role);
      const finalPermissions = { ...defaultPermissions, ...permissions };

      const user = await db.user.create({
        data: {
          tenantId: session.tenantId,
          name,
          email: email.toLowerCase(),
          passwordHash,
          role,
          phone,
          permissions: finalPermissions,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          phone: true,
          isActive: true,
          permissions: true,
          createdAt: true,
        },
      });

      return created({ user });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["SUPER_ADMIN", "COMPANY_ADMIN"]
);

function getDefaultPermissions(role: string): Record<string, boolean> {
  const staffDefaults = {
    viewBookings: true,
    manageBookings: true,
    viewContracts: true,
    manageContracts: true,
    viewInvoices: true,
    manageInvoices: false,
    viewFleet: true,
    manageFleet: false,
    viewService: true,
    manageService: true,
    viewCustomers: true,
    manageCustomers: true,
    viewReports: false,
    viewFinance: false,
    viewCalendar: true,
    manageDamages: true,
    manageDiscounts: false,
  };

  const partnerDefaults = {
    viewBookings: true,
    manageBookings: false,
    viewContracts: false,
    manageContracts: false,
    viewInvoices: false,
    manageInvoices: false,
    viewFleet: true,
    manageFleet: false,
    viewService: false,
    manageService: false,
    viewCustomers: false,
    manageCustomers: false,
    viewReports: false,
    viewFinance: false,
    viewCalendar: true,
    manageDamages: false,
    manageDiscounts: false,
  };

  if (role === "STAFF") return staffDefaults;
  if (role === "PARTNER") return partnerDefaults;
  return Object.fromEntries(Object.keys(staffDefaults).map((k) => [k, true]));
}

