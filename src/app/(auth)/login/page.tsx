// src/app/(auth)/login/page.tsx
// Σύνδεση. Ο σύνδεσμος «Δημιουργία εταιρίας» εμφανίζεται ΜΟΝΟ με
// SELF_SIGNUP_ENABLED (env του server — γι' αυτό περνά από εδώ).
//
// Ήδη συνδεδεμένος (έγκυρο session ΚΑΙ ενεργός χρήστης στη βάση) → κατευθείαν
// στην περιοχή του ρόλου του — έτσι το «Σύνδεση / Dashboard» του δημόσιου site
// δουλεύει με έναν σύνδεσμο. Ποια εταιρία: ΜΟΝΟ από το session.

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadViewer } from "@/lib/viewer";
import { loginRedirectFor } from "@/lib/loginRedirect";
import { normalizeLocale } from "@/lib/i18n/locale";
import { selfSignupEnabled } from "@/lib/signup/flag";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

type Props = { searchParams?: Record<string, string | string[] | undefined> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LoginPage({ searchParams = {} }: Props) {
  const callbackUrl = first(searchParams.callbackUrl);
  const session = await getSession();
  const viewer = session ? await loadViewer(session) : null;
  if (viewer) redirect(loginRedirectFor(viewer.role, callbackUrl));

  return (
    <LoginClient
      signupEnabled={selfSignupEnabled()}
      callbackUrl={callbackUrl ?? null}
      initialLocale={normalizeLocale(first(searchParams.lang))}
    />
  );
}
