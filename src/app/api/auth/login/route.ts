export const dynamic = "force-dynamic";
// src/app/api/auth/login/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signToken } from "@/lib/auth";
import { badRequest, serverError } from "@/lib/api";

const loginSchema = z.object({
  email: z.string().email("Μη έγκυρο email"),
  password: z.string().min(1, "Απαιτείται κωδικός"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
    }

    const { email, password } = parsed.data;

    // Αναζήτηση χρήστη
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        tenant: {
          select: {
            id: true,
            slug: true,
            name: true,
            status: true,
            brandColor: true,
            logoUrl: true,
          },
        },
      },
    });

    if (!user) {
      return badRequest("Λάθος email ή κωδικός");
    }

    if (!user.isActive) {
      return badRequest("Ο λογαριασμός σας έχει απενεργοποιηθεί");
    }

    // Έλεγχος κατάστασης tenant
    if (user.tenant && user.tenant.status === "SUSPENDED") {
      return badRequest(
        "Η εταιρία σας έχει ανασταλεί. Επικοινωνήστε με την υποστήριξη."
      );
    }

    // Επαλήθευση κωδικού
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return badRequest("Λάθος email ή κωδικός");
    }

    // Δημιουργία token
    const token = await signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tenantSlug: user.tenant?.slug || null,
      name: user.name,
    });

    // Ενημέρωση lastLoginAt
    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Response με cookie
    const response = NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          tenantId: user.tenantId,
          tenant: user.tenant,
          permissions: user.permissions,
        },
        redirectTo:
          user.role === "SUPER_ADMIN"
            ? "/super-admin"
            : `/dashboard`,
      },
    });

    // Set HTTP-only cookie
    response.cookies.set("fleetpro_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return serverError("Σφάλμα κατά τη σύνδεση");
  }
}
