export const dynamic = "force-dynamic";
// src/app/api/tenants/[id]/route.ts

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  withAuth,
  ok,
  notFound,
  badRequest,
  serverError,
  noContent,
} from "@/lib/api";

const updateTenantSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  vat: z.string().optional(),
  iban: z.string().optional(),
  logoUrl: z.string().optional(),
  brandColor: z.string().optional(),
  customDomain: z.string().optional(),
  website: z.string().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "TRIAL", "CANCELLED"]).optional(),
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]).optional(),
});

// GET /api/tenants/[id]
export const GET = withAuth(
  async (_req, _session, params) => {
    try {
      const tenant = await db.tenant.findUnique({
        where: { id: params!.id },
        include: {
          users: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              isActive: true,
              lastLoginAt: true,
            },
          },
          _count: {
            select: {
              vehicles: true,
              bookings: true,
              customers: true,
              contracts: true,
            },
          },
        },
      });

      if (!tenant) return notFound("Εταιρία δεν βρέθηκε");
      return ok(tenant);
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["SUPER_ADMIN"]
);

// PATCH /api/tenants/[id]
export const PATCH = withAuth(
  async (req, _session, params) => {
    try {
      const body = await req.json();
      const parsed = updateTenantSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const tenant = await db.tenant.update({
        where: { id: params!.id },
        data: parsed.data,
      });

      return ok(tenant);
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["SUPER_ADMIN"]
);

// DELETE /api/tenants/[id] — Μόνιμη διαγραφή (προσοχή!)
export const DELETE = withAuth(
  async (_req, _session, params) => {
    try {
      await db.tenant.delete({ where: { id: params!.id } });
      return noContent();
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["SUPER_ADMIN"]
);

