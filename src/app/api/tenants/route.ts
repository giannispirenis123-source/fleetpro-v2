// src/app/api/tenants/route.ts
// Super Admin only — διαχείριση tenants

import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { withAuth, ok, created, badRequest, serverError, getPagination, getSearch } from "@/lib/api";

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

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { slug: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [tenants, total] = await Promise.all([
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
        },
      }),
      db.tenant.count({ where }),
    ]);

    return ok({ tenants, total, page: Math.ceil(skip / limit) + 1, limit });
  } catch (error) {
    console.error(error);
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
      adminName,
      adminEmail,
      adminPassword,
    } = parsed.data;

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

    const passwordHash = await bcrypt.hash(adminPassword, 12);

    // Δημιουργία tenant + admin user σε transaction
    const tenant = await db.$transaction(async (tx) => {
      const newTenant = await tx.tenant.create({
        data: {
          name,
          slug,
          email: email.toLowerCase(),
          phone,
          address,
          plan,
          status: "TRIAL",
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
        },
      });

      await tx.user.create({
        data: {
          tenantId: newTenant.id,
          name: adminName,
          email: adminEmail.toLowerCase(),
          passwordHash,
          role: "COMPANY_ADMIN",
          permissions: {},
        },
      });

      // Default contract template
      await tx.contractTemplate.create({
        data: {
          tenantId: newTenant.id,
          name: "Βασικό Συμβόλαιο",
          content: getDefaultContractTemplate(),
          isDefault: true,
          language: "el",
        },
      });

      return newTenant;
    });

    return created({ tenant });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}, ["SUPER_ADMIN"]);

function getDefaultContractTemplate(): string {
  return `
<!DOCTYPE html>
<html lang="el">
<head><meta charset="UTF-8"><title>Συμβόλαιο Ενοικίασης</title></head>
<body>
  <h1>ΣΥΜΒΟΛΑΙΟ ΕΝΟΙΚΙΑΣΗΣ ΟΧΗΜΑΤΟΣ</h1>
  <p>Εταιρία: {{company.name}}</p>
  <p>Πελάτης: {{customer.fullName}}</p>
  <p>Όχημα: {{vehicle.brand}} {{vehicle.model}} ({{vehicle.plate}})</p>
  <p>Από: {{booking.pickupDate}} — Έως: {{booking.returnDate}}</p>
  <p>Σύνολο: {{booking.total}}€</p>
  <div class="signature-section">
    <p>Υπογραφή: ____________________</p>
  </div>
</body>
</html>
  `.trim();
}
\nexport const dynamic = "force-dynamic";
