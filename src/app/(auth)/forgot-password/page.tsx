// src/app/(auth)/forgot-password/page.tsx
// «Ξέχασα τον κωδικό μου» — δημόσια σελίδα (SQL 41). Η απάντηση είναι πάντα
// η ίδια, όποιο email κι αν δοθεί.

import type { Metadata } from "next";
import { signupLang } from "@/lib/signup/signup";
import ForgotClient from "./ForgotClient";
import "../auth-pages.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kratisi", robots: { index: false, follow: false } };

export default function ForgotPasswordPage({ searchParams }: { searchParams: { lang?: string } }) {
  return <ForgotClient initialLang={signupLang(searchParams.lang)} />;
}
