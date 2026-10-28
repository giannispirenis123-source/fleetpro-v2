export const dynamic = "force-dynamic";
// src/app/api/tenants/route.ts
// Super Admin only — διαχείριση tenants

import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { withAuth, ok, created, badRequest, serverError, getPagination, getSearch, logError } from "@/lib/api";
import { BCRYPT_ROUNDS, createTenantWithAdmin } from "@/lib/tenantCreate";
import { billingNow, tenantMrrCents, testClocksEnabled, trialDaysLeft } from "@/lib/billing/core";

const createTenantSchema = z.object({
  name: z.string().min(2, "Απαιτείται επωνυμία"),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Μόνο πεζά γράμματα, αριθμοί και παύλες"),
  email: z.string().email("Μη έγκυρο email"),
  phone: z.string().optional(),
  address: z.string().optional(),
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]).default("STARTER"),
  // Πακέτο (entitlements). Χωρίς επιλογή → «full», όπως όλες οι μέχρι
  // τώρα εταιρίες (SQL 20), ώστε τίποτα να μην κλειδώσει απροειδοποίητα.
  planKey: z.string().min(1).default("full"),
  // Admin user
  adminName: z.string().min(2, "Απαιτείται όνομα διαχειριστή"),
  adminEmail: z.string().email("Μη έγκυρο email διαχειριστή"),
  adminPassword: z.string().min(8, "Τουλάχιστον 8 χαρακτήρες"),
});

// GET /api/tenants — Λίστα tenants (Super Admin)
export const GET = withAuth(async (req) => {
  try {
    const { skip, limit } = getPagination(req);
    const search = getSearch(req);

    // Προέλευση (SQL 34): ?source=self_signup | manual
    const source = new URL(req.url).searchParams.get("source");
    const where = {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
              { slug: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(source === "self_signup" || source === "manual" ? { signupSource: source } : {}),
    };

    const [rows, total] = await Promise.all([
      db.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: {
              users: true,
              vehicles: true,
              bookings: true,
            },
          },
          // «Email επαληθευμένο»: τουλάχιστον ένας χρήστης με emailVerifiedAt.
          users: { where: { emailVerifiedAt: { not: null } }, select: { id: true }, take: 1 },
          // Πρόγραμμα ιδρυτών (SQL 36): μόνο ο αριθμός θέσης.
          founderClaim: { select: { slotNumber: true } },
          // Τιμολόγια ιδρυτή πληρωμένα ΧΩΡΙΣ έκπτωση (SQL 37) — ένδειξη για τον Super Admin.
          founderFullCharges: { select: { stripeInvoiceId: true, amountCents: true }, orderBy: { createdAt: "desc" }, take: 3 },
          // MRR: τιμές πλάνου + μήνες έκπτωσης ιδρυτή (μένουν στον server).
          entitlementPlan: { select: { priceMonthlyCents: true, priceYearlyCents: true } },
          founderInvoices: { select: { months: true, status: true } },
        },
      }),
      db.tenant.count({ where }),
    ]);
    const now = new Date();
    const clocksOn = testClocksEnabled(process.env);
    const tenants = rows.map(({ users, onboardingState: _onboarding, founderClaim, entitlementPlan, founderInvoices, ...t }) => ({
      ...t,
      emailVerified: users.length > 0,
      founderSlot: founderClaim?.slotNumber ?? null,
      // «Νημ.» / «Έληξε» μόνο σε δοκιμή, με την ώρα του test clock όπου υπάρχει.
      trialDaysLeft: trialDaysLeft(t, billingNow(t, now, clocksOn)),
      mrrCents: tenantMrrCents(
        {
          billingStatus: t.billingStatus,
          billingInterval: t.billingInterval,
          priceMonthlyCents: entitlementPlan?.priceMonthlyCents ?? null,
          priceYearlyCents: entitlementPlan?.priceYearlyCents ?? null,
          isFounder: Boolean(founderClaim),
          founderRows: founderInvoices,
          founderDiscountEndsAt: t.founderDiscountEndsAt,
        },
        now
      ),
    }));

    return ok({ tenants, total, page: Math.ceil(skip / limit) + 1, limit });
  } catch (error) {
    logError("tenants", error);
    return serverError();
  }
}, ["SUPER_ADMIN"]);

// POST /api/tenants — Δημιουργία νέου tenant
export const POST = withAuth(async (req) => {
  try {
    const body = await req.json();
    const parsed = createTenantSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
    }

    const {
      name,
      slug,
      email,
      phone,
      address,
      plan,
      planKey,
      adminName,
      adminEmail,
      adminPassword,
    } = parsed.data;

    const planRow = await db.plan.findUnique({ where: { key: planKey }, select: { key: true } });
    if (!planRow) return badRequest("Άγνωστο πακέτο");

    // Έλεγχος αν υπάρχει ήδη
    const existing = await db.tenant.findFirst({
      where: { OR: [{ slug }, { email }] },
    });

    if (existing) {
      return badRequest(
        existing.slug === slug
          ? "Το slug χρησιμοποιείται ήδη"
          : "Το email χρησιμοποιείται ήδη"
      );
    }

    // Έλεγχος αν υπάρχει ήδη ο admin user
    const existingUser = await db.user.findUnique({
      where: { email: adminEmail.toLowerCase() },
    });

    if (existingUser) {
      return badRequest("Το email του διαχειριστή χρησιμοποιείται ήδη");
    }

    const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS);

    // Δημιουργία tenant + admin user + βασικό συμβόλαιο σε transaction — ο ΙΔΙΟΣ
    // μηχανισμός με την αυτόματη εγγραφή (src/lib/tenantCreate.ts).
    const { tenant } = await db.$transaction((tx) =>
      createTenantWithAdmin(tx, {
        name,
        slug,
        email,
        phone,
        address,
        plan,
        planKey,
        signupSource: "manual",
        admin: { name: adminName, email: adminEmail, passwordHash },
      })
    );

    return created({ tenant });
  } catch (error) {
    logError("tenants", error);
    return serverError();
  }
}, ["SUPER_ADMIN"]);
