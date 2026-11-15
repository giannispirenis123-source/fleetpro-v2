export const dynamic = "force-dynamic";
// src/app/api/auth/reset-password/route.ts
// POST /api/auth/reset-password — νέος κωδικός με τον σύνδεσμο του email
// (δημόσιο). SQL 41. Token μίας χρήσης (μόνο hash στη βάση), όριο ανά IP,
// ίδιο μήνυμα για άκυρο/ληγμένο/χρησιμοποιημένο. Καμία αυτόματη σύνδεση.

import { NextRequest } from "next/server";
import { logError, serverError } from "@/lib/api";
import { RESET_MESSAGES, resetSchema } from "@/lib/passwordReset";
import { performReset } from "@/lib/passwordResetServer";
import { clientIp, isJsonRequest, json, notJson } from "@/lib/signup/request";
import { signupLang } from "@/lib/signup/signup";

export async function POST(req: NextRequest) {
  if (!isJsonRequest(req)) return notJson();
  try {
    const body = await req.json().catch(() => null);
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      const lang = signupLang((body as { lang?: unknown } | null)?.lang);
      const weak = parsed.error.errors.some((e) => e.path[0] === "password");
      return json(400, { message: (weak ? RESET_MESSAGES.weak : RESET_MESSAGES.badLink)[lang], code: weak ? "password" : "token" });
    }
    const r = await performReset(parsed.data.token, parsed.data.password, parsed.data.lang, clientIp(req));
    return json(r.status, { message: r.message, ...(r.status === 400 ? { code: "token" } : {}) });
  } catch (error) {
    // Σκόπιμα δεν περνάμε το body στο log.
    logError("reset-password", error);
    return serverError();
  }
}
