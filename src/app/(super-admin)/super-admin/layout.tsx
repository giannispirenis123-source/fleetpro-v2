// src/app/(super-admin)/super-admin/layout.tsx
// Δίνει τη γλώσσα του Super Admin στα client components (useT).
// Η πρόσβαση ελέγχεται ήδη στο middleware.

import { getSession } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n/I18nProvider";

export const dynamic = "force-dynamic";

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  return <I18nProvider locale={session?.locale}>{children}</I18nProvider>;
}
