"use client";

// src/components/menu/LanguageMenu.tsx
// Το κουτί «Γλώσσα» — ΙΔΙΟ στο δημόσιο site και στο dashboard. Οι γλώσσες
// και τα ονόματά τους (στη δική τους γλώσσα) από ΤΟ κεντρικό σημείο
// (src/lib/i18n/languages.ts)· η τρέχουσα με ✓. ΔΕΝ αποθηκεύει τίποτα μόνο του:
// · site: σύνδεσμος στο ίδιο URL σε άλλη γλώσσα (`hrefs`, έτοιμα από τον server) — όπως πριν·
// · dashboard: `onSelect` → ο υπάρχων μηχανισμός (PATCH /api/users/me/locale).

import { languageName } from "@/lib/i18n/languages";
import MenuButton, { type MenuItem } from "./MenuButton";

export default function LanguageMenu({
  current,
  codes,
  buttonLabel,
  hrefs,
  onSelect,
  disabled = false,
  align = "end",
  className,
  testId = "language-menu",
}: {
  current: string;
  /** Οι διαθέσιμες γλώσσες (κωδικοί του κεντρικού πίνακα), με τη σειρά τους. */
  codes: readonly string[];
  /** «Γλώσσα» / «Language» στη γλώσσα της σελίδας. */
  buttonLabel: string;
  /** Site: το URL κάθε γλώσσας (από τον server — συναρτήσεις δεν περνούν σε client component). */
  hrefs?: Record<string, string>;
  onSelect?: (code: string) => void;
  disabled?: boolean;
  align?: "start" | "end";
  className?: string;
  testId?: string;
}) {
  const items: MenuItem[] = codes.map((code) => ({
    key: code,
    label: languageName(code),
    checked: code === current,
    lang: code,
    hrefLang: hrefs ? code : undefined,
    href: hrefs?.[code],
    onSelect: hrefs ? undefined : () => {
      if (code !== current) onSelect?.(code);
    },
    disabled,
    testId: `${testId}-${code}`,
  }));
  return (
    <MenuButton
      label={buttonLabel}
      ariaLabel={`${buttonLabel}: ${languageName(current)}`}
      items={items}
      align={align}
      className={className}
      testId={testId}
    />
  );
}
