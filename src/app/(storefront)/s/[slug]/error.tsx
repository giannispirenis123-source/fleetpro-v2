"use client";
// Σφάλμα στο δημόσιο site /s/<slug>/…: στη γλώσσα της σελίδας (από το URL),
// με επιστροφή στην αρχική του site. ΠΟΤΕ τεχνικό μήνυμα, stack ή στοιχεία
// πελάτη/εταιρίας — μόνο ο κωδικός digest για αναφορά.

import { usePathname } from "next/navigation";
import ErrorScreen from "@/components/errors/ErrorScreen";

export default function StorefrontError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [, , slug = "", lang = ""] = (usePathname() ?? "").split("/");
  const safeSlug = /^[a-z0-9-]{1,60}$/.test(slug) ? slug : null;
  const l = lang === "el" ? "el" : lang === "en" ? "en" : "both";
  const home = safeSlug ? `/s/${safeSlug}${l === "both" ? "" : `/${lang}`}` : "/";
  return (
    <ErrorScreen
      lang={l}
      digest={error.digest}
      onRetry={reset}
      back={{ href: home, label: l === "en" ? "Home" : l === "el" ? "Αρχική" : "Αρχική / Home" }}
    />
  );
}
