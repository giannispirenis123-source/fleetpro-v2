// src/app/(auth)/reset-password/page.tsx
// Ορισμός νέου κωδικού με τον σύνδεσμο του email (SQL 41). Το token ΔΕΝ
// καταναλώνεται με το άνοιγμα της σελίδας (σκάνερ συνδέσμων): μόνο με την
// υποβολή (POST). Η μορφή του ελέγχεται πριν φτάσει οπουδήποτε.

import type { Metadata } from "next";
import { signupLang } from "@/lib/signup/signup";
import { isTokenShape } from "@/lib/signup/token";
import ResetClient from "./ResetClient";
import "../auth-pages.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kratisi", robots: { index: false, follow: false } };

export default function ResetPasswordPage({ searchParams }: { searchParams: { token?: string; lang?: string } }) {
  const token = isTokenShape(searchParams.token) ? searchParams.token : null;
  return <ResetClient token={token} initialLang={signupLang(searchParams.lang)} />;
}
