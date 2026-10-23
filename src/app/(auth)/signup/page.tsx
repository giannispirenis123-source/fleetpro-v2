// src/app/(auth)/signup/page.tsx
// Αυτόματη εγγραφή εταιρίας. Με SELF_SIGNUP_ENABLED OFF: 404 (ίδιο με
// οποιαδήποτε άγνωστη διαδρομή).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { selfSignupEnabled } from "@/lib/signup/flag";
import { signupLang } from "@/lib/signup/signup";
import SignupClient from "./SignupClient";
import "../auth-pages.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "FleetPro", robots: { index: false, follow: false } };

export default function SignupPage({ searchParams }: { searchParams: { lang?: string } }) {
  if (!selfSignupEnabled()) notFound();
  return <SignupClient initialLang={signupLang(searchParams.lang)} />;
}
