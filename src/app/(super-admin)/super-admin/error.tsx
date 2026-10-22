"use client";
// Σφάλμα στο panel του Super Admin — κανένα μήνυμα/stack, μόνο ο κωδικός digest.

import ErrorScreen from "@/components/errors/ErrorScreen";
import { useLocale } from "@/lib/i18n/I18nProvider";

export default function SuperAdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const lang = useLocale() === "en" ? "en" : "el";
  return <ErrorScreen lang={lang} digest={error.digest} onRetry={reset} back={{ href: "/super-admin", label: "Super Admin" }} />;
}
