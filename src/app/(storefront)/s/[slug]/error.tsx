"use client";
// Σφάλμα στο δημόσιο site /s/<slug>/… (ή στο domain της εταιρίας /<lang>/…):
// στη γλώσσα της σελίδας (από το URL), με επιστροφή στην αρχική του site.
// ΠΟΤΕ τεχνικό μήνυμα, stack ή στοιχεία πελάτη/εταιρίας — μόνο ο κωδικός
// digest για αναφορά.

import { usePathname } from "next/navigation";
import ErrorScreen from "@/components/errors/ErrorScreen";

export default function StorefrontError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const parts = (usePathname() ?? "").split("/");
  // Ο browser βλέπει το URL του επισκέπτη: /s/<slug>/<lang>/… στην πλατφόρμα,
  // /<lang>/… στο domain της εταιρίας (το middleware κάνει εσωτερικό rewrite).
  const onPlatform = parts[1] === "s";
  const slug = onPlatform ? (parts[2] ?? "") : "";
  const lang = (onPlatform ? parts[3] : parts[1]) ?? "";
  const safeSlug = /^[a-z0-9-]{1,60}$/.test(slug) ? slug : null;
  const l = lang === "el" ? "el" : lang === "en" ? "en" : "both";
  const langPart = l === "both" ? "" : `/${lang}`;
  const home = onPlatform ? (safeSlug ? `/s/${safeSlug}${langPart}` : "/") : langPart || "/";
  return (
    <ErrorScreen
      lang={l}
      digest={error.digest}
      onRetry={reset}
      back={{ href: home, label: l === "en" ? "Home" : l === "el" ? "Αρχική" : "Αρχική / Home" }}
    />
  );
}
