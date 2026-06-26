// src/app/api/discounts/route.ts
// Σύστημα εκπτώσεων ανά tenant

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  withAuth,
  ok,
  created,
  badRequest,
  serverError,
} from "@/lib/api";

const createDiscountSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(2, "Απαιτείται όνομα"),
  description: z.string().optional(),
  type: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
  value: z.number().positive("Θετική τιμή"),
  target: z.enum(["ALL", "CATEGORY", "VEHICLE", "CUSTOMER"]).default("ALL"),
  targetValue: z.string().optional(),
  minDays: z.number().int().optional(),
  minAmount: z.number().optional(),
  maxDiscount: z.number().optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  usageLimit: z.number().int().optional(),
  isActive: z.boolean().default(true),
  isLoyalty: z.boolean().default(false),
  loyaltyMinBookings: z.number().int().optional(),
  isSeasonal: z.boolean().default(false),
});

// GET /api/discounts
export const GET = withAuth(
  async (req, session) => {
    try {
      const url = new URL(req.url);
      const includeInactive = url.searchParams.get("includeInactive") === "true";

      const where = {
        tenantId: session.tenantId!,
        ...(includeInactive ? {} : { isActive: true }),
      };

      const discounts = await db.discount.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });

      return ok(discounts);
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["SUPER_ADMIN", "COMPANY_ADMIN", "STAFF"]
);

// POST /api/discounts
export const POST = withAuth(
  async (req, session) => {
    try {
      const body = await req.json();
      const parsed = createDiscountSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      // Αν έχει κωδικό, έλεγχος μοναδικότητας
      if (parsed.data.code) {
        const existing = await db.discount.findFirst({
          where: {
            tenantId: session.tenantId!,
            code: parsed.data.code.toUpperCase(),
          },
        });
        if (existing) return badRequest("Ο κωδικός έκπτωσης υπάρχει ήδη");
      }

      const discount = await db.discount.create({
        data: {
          ...parsed.data,
          tenantId: session.tenantId!,
          code: parsed.data.code?.toUpperCase(),
          value: parsed.data.value,
        },
      });

      return created({ discount });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["SUPER_ADMIN", "COMPANY_ADMIN"]
);
\nexport const dynamic = "force-dynamic";
