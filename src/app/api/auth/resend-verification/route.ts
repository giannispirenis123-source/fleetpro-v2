export const dynamic = "force-dynamic";
// src/app/api/auth/resend-verification/route.ts
// POST /api/auth/resend-verification — «Ξαναστείλε email» (μόνο με SELF_SIGNUP_ENABLED).
// Ουδέτερη απάντηση πάντα· όριο ανά IP και ανά email.

import { NextRequest } from "next/server";
import { logError, serverError } from "@/lib/api";
import { publicOrigin } from "@/lib/bookingDecisionServer";
import { selfSignupEnabled } from "@/lib/signup/flag";
import { clientIp, isJsonRequest, json, notJson, signupOff } from "@/lib/signup/request";
import { SIGNUP_ERRORS, resendSchema, signupLang } from "@/lib/signup/signup";
import { resendFlow } from "@/lib/signup/signupServer";

export async function POST(req: NextRequest) {
  if (!selfSignupEnabled()) return signupOff();
  if (!isJsonRequest(req)) return notJson();
  try {
    const body = await req.json().catch(() => null);
    const parsed = resendSchema.safeParse(body);
    if (!parsed.success) {
      return json(400, { message: SIGNUP_ERRORS.invalid[signupLang((body as { lang?: unknown } | null)?.lang)], code: "validation" });
    }
    const r = await resendFlow(parsed.data.email, parsed.data.lang, clientIp(req), publicOrigin(req));
    return json(r.status, r.body);
  } catch (error) {
    logError("resend-verification", error);
    return serverError();
  }
}
