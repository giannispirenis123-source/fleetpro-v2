// src/app/(auth)/login/page.tsx
// Σύνδεση. Ο σύνδεσμος «Δημιουργία εταιρίας» εμφανίζεται ΜΟΝΟ με
// SELF_SIGNUP_ENABLED (env του server — γι' αυτό περνά από εδώ).

import { selfSignupEnabled } from "@/lib/signup/flag";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginClient signupEnabled={selfSignupEnabled()} />;
}
