"use client";
// Σφάλμα σε σελίδα του dashboard: το sidebar μένει, η οθόνη στη γλώσσα του χρήστη.
// Κανένα μήνυμα/stack — μόνο ο κωδικός digest (ίδιος με τα logs του Vercel).

import ErrorScreen from "@/components/errors/ErrorScreen";
import { useLocale } from "@/lib/i18n/I18nProvider";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const lang = useLocale() === "en" ? "en" : "el";
  return (
    <ErrorScreen
      lang={lang}
      digest={error.digest}
      onRetry={reset}
      back={{ href: "/dashboard", label: lang === "en" ? "Dashboard" : "Πίνακας" }}
      fullPage={false}
    />
  );
}
