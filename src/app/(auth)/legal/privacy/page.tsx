// src/app/(auth)/legal/privacy/page.tsx
// ΠΡΟΣΩΡΙΝΟ κείμενο της πλατφόρμας (όχι της εταιρίας — αυτά είναι στο
// /s/<slug>/<lang>/privacy). Το τελικό έρχεται μετά από έλεγχο από νομικό.

import type { Metadata } from "next";
import LegalPlaceholder from "../LegalPlaceholder";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "FleetPro", robots: { index: false, follow: false } };

export default function Page({ searchParams }: { searchParams: { lang?: string } }) {
  return <LegalPlaceholder kind="privacy" lang={searchParams.lang} />;
}
