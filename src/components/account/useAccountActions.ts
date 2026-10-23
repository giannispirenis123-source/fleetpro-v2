"use client";

// src/components/account/useAccountActions.ts
// Ενέργειες λογαριασμού για το μενού λογαριασμού (dashboard + Super Admin) και
// τη σελίδα «Ο λογαριασμός μου». ΙΔΙΟΙ μηχανισμοί με πριν (μόνο άλλαξε η θέση τους στο UI):
//  · γλώσσα: PATCH /api/users/me/locale (αποθήκευση στον χρήστη) + refresh·
//  · αποσύνδεση: POST /api/auth/logout → /login.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/I18nProvider";
import type { Locale } from "@/lib/i18n/locale";

export function useAccountActions() {
  const router = useRouter();
  const locale = useLocale();
  const [savingLocale, startSavingLocale] = useTransition();

  // Αποθηκεύει τη γλώσσα στον χρήστη και ανανεώνει, ώστε ο server
  // να ξαναφτιάξει τη σελίδα στη νέα γλώσσα.
  const changeLocale = (next: Locale) => {
    if (next === locale || savingLocale) return;
    startSavingLocale(async () => {
      await fetch("/api/users/me/locale", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      router.refresh();
    });
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return { locale, changeLocale, savingLocale, logout };
}

export const LOCALE_SHORT: Record<Locale, string> = { el: "ΕΛ", en: "EN" };

export const ROLE_LABEL_KEY: Record<string, string> = {
  COMPANY_ADMIN: "sidebar.roleCompanyAdmin",
  STAFF: "sidebar.roleStaff",
  PARTNER: "sidebar.rolePartner",
  SUPER_ADMIN: "sidebar.roleSuperAdmin",
};

export const initialsOf = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
