"use client";

// src/lib/i18n/I18nProvider.tsx
// Ο server δίνει τη γλώσσα μία φορά· τα client components τη διαβάζουν από εδώ
// χωρίς να ξαναχτυπήσουν τη βάση ή το API.

import { createContext, useContext, useMemo } from "react";
import { t as translate } from "./index";
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "./locale";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({
  locale,
  children,
}: {
  locale: string | null | undefined;
  children: React.ReactNode;
}) {
  const value = normalizeLocale(locale);
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

/** Η τρέχουσα γλώσσα μέσα σε client component. */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** const tr = useT(); tr("sidebar.fleet") */
export function useT() {
  const locale = useLocale();
  return useMemo(() => (key: string) => translate(key, locale), [locale]);
}
