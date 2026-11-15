export const dynamic = "force-dynamic";
// src/app/api/auth/forgot-password/route.ts
// POST /api/auth/forgot-password — «Ξέχασα τον κωδικό μου» (δημόσιο). SQL 41.
// ΠΑΝΤΑ η ίδια απάντηση, όποιο email κι αν δοθεί· όριο ανά IP (429) και ανά
// email (σιωπηλό)· ελάχιστος χρόνος απάντησης. Λογική: passwordResetServer.ts.

import { NextRequest } from "next/server";
import { logError, serverError } from "@/lib/api";
import { publicOrigin } from "@/lib/bookingDecisionServer";
import { RESET_MESSAGES, forgotSchema } from "@/lib/passwordReset";
import { requestReset } from "@/lib/passwordResetServer";
import { clientIp, isJsonRequest, json, notJson } from "@/lib/signup/request";
import { signupLang } from "@/lib/signup/signup";
import { linkOrigin } from "@/lib/signup/signupServer";

export async function POST(req: NextRequest) {
  if (!isJsonRequest(req)) return notJson();
  try {
    const body = await req.json().catch(() => null);
    const parsed = forgotSchema.safeParse(body);
    if (!parsed.success) {
      return json(400, { message: RESET_MESSAGES.invalidEmail[signupLang((body as { lang?: unknown } | null)?.lang)], code: "validation" });
    }
    const r = await requestReset(parsed.data.email, parsed.data.lang, clientIp(req), linkOrigin(publicOrigin(req)));
    return json(r.status, { message: r.message });
  } catch (error) {
    logError("forgot-password", error);
    return serverError();
  }
}
