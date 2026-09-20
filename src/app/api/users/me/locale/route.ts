export const dynamic = "force-dynamic";
// src/app/api/users/me/locale/route.ts
// Αλλαγή γλώσσας του ΤΡΕΧΟΝΤΟΣ χρήστη. Το id έρχεται από το session,
// ποτέ από το request — κανείς δεν μπορεί να αλλάξει τη γλώσσα άλλου.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionFromRequest, signToken } from "@/lib/auth";
import { badRequest, serverError, unauthorized } from "@/lib/api";
import { LOCALES } from "@/lib/i18n/locale";

const localeSchema = z.object({
  locale: z.enum(["el", "en"]),
});

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return unauthorized();

    const parsed = localeSchema.safeParse(await req.json());
    if (!parsed.success) {
      return badRequest(
        `Μη έγκυρη γλώσσα. Επιτρεπτές τιμές: ${LOCALES.join(", ")}`,
        parsed.error.errors
      );
    }

    const { locale } = parsed.data;

    await db.user.update({
      where: { id: session.userId },
      data: { locale },
    });

    // Νέο token με τη νέα γλώσσα, ώστε να ισχύει αμέσως στο επόμενο request.
    const token = await signToken({
      userId: session.userId,
      email: session.email,
      role: session.role,
      tenantId: session.tenantId,
      tenantSlug: session.tenantSlug,
      name: session.name,
      locale,
    });

    const response = NextResponse.json({ success: true, data: { locale } });

    response.cookies.set("fleetpro_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 ημέρες, όπως και στο login
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Locale update error:", error);
    return serverError();
  }
}
