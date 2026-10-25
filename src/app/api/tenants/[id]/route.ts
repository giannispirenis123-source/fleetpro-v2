export const dynamic = "force-dynamic";
// src/app/api/tenants/[id]/route.ts

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { withAuth, ok, notFound, badRequest, serverError, logError } from "@/lib/api";
import { TenantDeleteError, deleteTenant } from "@/lib/tenantDelete";
import { SUBSCRIPTION_PLAN_OF, isBillingPlanKey } from "@/lib/billing/core";

const updateTenantSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  vat: z.string().optional(),
  iban: z.string().optional(),
  logoUrl: z.string().optional(),
  brandColor: z.string().optional(),
  // Το customDomain ΔΕΝ αλλάζει από εδώ: μόνο από «Η σελίδα μου» → «Domain»
  // (έλεγχοι μορφής, μοναδικότητας και επαλήθευση DNS — SQL 33).
  website: z.string().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "TRIAL", "CANCELLED"]).optional(),
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]).optional(),
  // Πακέτο (entitlements) — κλειδί του πίνακα plans· null = χωρίς πακέτο.
  planKey: z.string().min(1).nullable().optional(),
  // Προμήθεια πλατφόρμας στις online πληρωμές (basis points, 100 = 1%) — ΜΟΝΟ Super Admin.
  platformFeeBps: z.number().int().min(0).max(5000).optional(),
  // Συνδρομή (SQL 36) — ΧΕΙΡΟΚΙΝΗΤΑ μόνο οι καταστάσεις πριν από το Stripe.
  // Οι καταστάσεις του Stripe (trialing/active/…) έρχονται ΜΟΝΟ από το webhook.
  billingStatus: z.enum(["exempt", "founder_trial", "awaiting_checkout"]).optional(),
  // Λήξη δοκιμής "YYYY-MM-DD" (τέλος ημέρας ώρα Ελλάδας) ή null = καμία.
  trialEndsOn: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional(),
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
      logError("tenants/[id]", error);
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

      if (parsed.data.planKey) {
        const plan = await db.plan.findUnique({
          where: { key: parsed.data.planKey },
          select: { key: true },
        });
        if (!plan) return badRequest("Άγνωστο πακέτο");
      }

      const { trialEndsOn, ...rest } = parsed.data;
      const data: Prisma.TenantUpdateInput = { ...rest };
      // Πλάνο συνδρομής → και το παλιό enum "plan" (εμφάνιση/MRR) ακολουθεί.
      if (isBillingPlanKey(rest.planKey) && !rest.plan) data.plan = SUBSCRIPTION_PLAN_OF[rest.planKey];
      if (trialEndsOn !== undefined) {
        data.trialEndsAt = trialEndsOn ? new Date(`${trialEndsOn}T21:00:00.000Z`) : null;
        // Χειροκίνητη δοκιμή ιδρυτή με ημερομηνία = το ρολόι θεωρείται ξεκινημένο.
        if (trialEndsOn) data.trialStartedAt = new Date();
      }

      const tenant = await db.tenant.update({
        where: { id: params!.id },
        data,
      });

      return ok(tenant);
    } catch (error) {
      logError("tenants/[id]", error);
      return serverError();
    }
  },
  ["SUPER_ADMIN"]
);

// DELETE /api/tenants/[id] { confirmName, releaseFounderSlot? } — ΟΡΙΣΤΙΚΗ
// διαγραφή εταιρίας με ΟΛΑ τα δεδομένα και τους χρήστες της (src/lib/tenantDelete.ts).
// Μόνο με το ΑΚΡΙΒΕΣ όνομα· ζωντανή συνδρομή Stripe → 409.
export const DELETE = withAuth(
  async (req, _session, params) => {
    try {
      const body = (await req.json().catch(() => ({}))) as { confirmName?: unknown; releaseFounderSlot?: unknown };
      const r = await deleteTenant(params!.id, {
        confirmName: body.confirmName,
        releaseFounderSlot: body.releaseFounderSlot === true,
      });
      return ok({ deleted: r.id, releasedSlot: r.releasedSlot });
    } catch (error) {
      if (error instanceof TenantDeleteError) {
        return NextResponse.json({ success: false, message: error.message }, { status: error.status });
      }
      logError("tenants/[id] delete", error);
      return serverError();
    }
  },
  ["SUPER_ADMIN"]
);
