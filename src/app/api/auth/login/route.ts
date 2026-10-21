export const dynamic = "force-dynamic";
// src/app/api/auth/login/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signToken } from "@/lib/auth";
import { normalizeLocale } from "@/lib/i18n/locale";
import { badRequest, logError, serverError } from "@/lib/api";
import { LOGIN_MSG, loginDecision } from "@/lib/loginCore";
import { hitLimit, LIMITS } from "@/lib/public/rateLimit";
import { dbCounterStore } from "@/lib/public/rateLimitStore";
import { LOGIN_LOCK, clearLoginFailures, isLoginLocked, recordLoginFailure } from "@/lib/loginLock";
import { dbLoginLockStore } from "@/lib/loginLockStore";

// bcrypt και για άγνωστο email: ίδιος χρόνος απάντησης (δεν μαρτυρά ποια email υπάρχουν).
const DUMMY_HASH = bcrypt.hashSync("fleetpro-not-a-password", 10);

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

    // Όριο προσπαθειών ανά IP (όλες) και κλείδωμα 15΄ μετά από 10 ΛΑΘΟΣ
    // κωδικούς (email + IP). Ίδια απάντηση για άγνωστο και υπαρκτό email.
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const okIp = await hitLimit(dbCounterStore, LIMITS.loginPerIp, ip);
    if (!okIp || (await isLoginLocked(dbLoginLockStore, email, ip))) {
      return NextResponse.json({ success: false, message: LOGIN_MSG.tooMany }, { status: 429 });
    }

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

    // Κωδικός ΠΡΩΤΑ (και για άγνωστο email), μετά κατάσταση λογαριασμού/εταιρίας.
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!passwordOk) {
      const { lockedNow } = await recordLoginFailure(dbLoginLockStore, email, ip);
      // Ένδειξη στο ιστορικό (μόνο για υπαρκτό χρήστη· χωρίς IP/κωδικό).
      if (lockedNow && user) {
        await db.activityLog.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            action: "auth.login_locked",
            entity: "User",
            entityId: user.id,
            newData: { failures: LOGIN_LOCK.maxFailures, minutes: LOGIN_LOCK.lockMinutes },
          },
        });
      }
    }
    const decision = loginDecision(user, passwordOk);
    if (!decision.ok || !user) {
      return badRequest(decision.ok ? LOGIN_MSG.wrong : decision.message);
    }

    // Σωστή σύνδεση: τα λάθη αυτού του email από αυτή την IP μηδενίζονται.
    await clearLoginFailures(dbLoginLockStore, email, ip);

    // Δημιουργία token
    const token = await signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tenantSlug: user.tenant?.slug || null,
      name: user.name,
      locale: normalizeLocale(user.locale),
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
          locale: normalizeLocale(user.locale),
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
    logError("login", error);
    return serverError("Σφάλμα κατά τη σύνδεση");
  }
}
