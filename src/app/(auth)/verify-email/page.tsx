// src/app/(auth)/verify-email/page.tsx
// Επαλήθευση email + «Ξαναστείλε email». Με SELF_SIGNUP_ENABLED OFF: 404.
// Το token ΔΕΝ καταναλώνεται με το άνοιγμα της σελίδας (σκάνερ συνδέσμων):
// μόνο με το κουμπί (POST).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { selfSignupEnabled } from "@/lib/signup/flag";
import { signupLang } from "@/lib/signup/signup";
import { isTokenShape } from "@/lib/signup/token";
import VerifyClient from "./VerifyClient";
import "../auth-pages.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "FleetPro", robots: { index: false, follow: false } };

export default function VerifyEmailPage({ searchParams }: { searchParams: { token?: string; lang?: string } }) {
  if (!selfSignupEnabled()) notFound();
  const token = isTokenShape(searchParams.token) ? searchParams.token : null;
  return <VerifyClient token={token} initialLang={signupLang(searchParams.lang)} />;
}
