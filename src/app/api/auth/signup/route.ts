export const dynamic = "force-dynamic";
// src/app/api/auth/signup/route.ts
// POST /api/auth/signup — αυτόματη εγγραφή εταιρίας (μόνο με SELF_SIGNUP_ENABLED).
// Η ροή: src/lib/signup/signupServer.ts. Η απάντηση είναι ΙΔΙΑ για νέο email,
// υπάρχον email και honeypot (καμία αποκάλυψη λογαριασμών).

import { NextRequest } from "next/server";
import { logError, serverError } from "@/lib/api";
import { publicOrigin } from "@/lib/bookingDecisionServer";
import { selfSignupEnabled } from "@/lib/signup/flag";
import { clientIp, isJsonRequest, json, notJson, signupOff } from "@/lib/signup/request";
import { SIGNUP_ERRORS, signupLang, signupSchema } from "@/lib/signup/signup";
import { signupFlow } from "@/lib/signup/signupServer";

export async function POST(req: NextRequest) {
  if (!selfSignupEnabled()) return signupOff();
  if (!isJsonRequest(req)) return notJson();
  try {
    const body = await req.json().catch(() => null);
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      const lang = signupLang((body as { lang?: unknown } | null)?.lang);
      return json(400, {
        message: SIGNUP_ERRORS.invalid[lang],
        code: "validation",
        fields: Array.from(new Set(parsed.error.errors.map((e) => String(e.path[0] ?? "")))),
      });
    }
    const r = await signupFlow(parsed.data, clientIp(req), publicOrigin(req));
    return json(r.status, r.body);
  } catch (error) {
    logError("signup", error);
    return serverError();
  }
}
