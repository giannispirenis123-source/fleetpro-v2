export const dynamic = "force-dynamic";
// src/app/api/auth/verify-email/route.ts
// POST /api/auth/verify-email { token } — επαλήθευση + αυτόματη σύνδεση και
// μεταφορά στο onboarding (μόνο με SELF_SIGNUP_ENABLED). POST και όχι GET:
// τα «σκάνερ» συνδέσμων των email δεν καταναλώνουν το token.

import { NextRequest } from "next/server";
import { logError, serverError } from "@/lib/api";
import { selfSignupEnabled } from "@/lib/signup/flag";
import { clientIp, isJsonRequest, json, notJson, signupOff } from "@/lib/signup/request";
import { verifySchema } from "@/lib/signup/signup";
import { verifyFlow } from "@/lib/signup/signupServer";
import { setSessionCookie } from "@/lib/sessionCookie";

const ONBOARDING_PATH = "/dashboard/onboarding";

export async function POST(req: NextRequest) {
  if (!selfSignupEnabled()) return signupOff();
  if (!isJsonRequest(req)) return notJson();
  try {
    const body = (await req.json().catch(() => null)) as { lang?: unknown } | null;
    const parsed = verifySchema.safeParse(body);
    const r = await verifyFlow(parsed.success ? parsed.data.token : null, body?.lang, clientIp(req));
    if (!r.ok) return json(r.status, { message: r.message, code: r.code });
    const res = json(200, { data: { redirectTo: ONBOARDING_PATH } });
    await setSessionCookie(res, r.session);
    return res;
  } catch (error) {
    logError("verify-email", error);
    return serverError();
  }
}
