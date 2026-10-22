"use client";
// Σφάλμα στη σελίδα πελάτη /c/<token>: δίγλωσσο, χωρίς τεχνικό μήνυμα, stack ή
// στοιχεία του συμβολαίου — μόνο ο κωδικός digest. «Επιστροφή» = ξανά η ίδια σελίδα.

import { usePathname } from "next/navigation";
import ErrorScreen from "@/components/errors/ErrorScreen";

export default function CustomerPageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const path = usePathname() ?? "/";
  return (
    <ErrorScreen
      lang="both"
      digest={error.digest}
      onRetry={reset}
      back={{ href: /^\/c\/[A-Za-z0-9_-]+$/.test(path) ? path : "/", label: "Ανανέωση / Reload" }}
    />
  );
}
