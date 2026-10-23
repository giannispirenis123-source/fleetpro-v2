// src/app/(super-admin)/super-admin/layout.tsx
// Δίνει τη γλώσσα του Super Admin στα client components (useT) και τα
// στοιχεία του συνδεδεμένου (όνομα/email) στο μενού λογαριασμού.
// Η πρόσβαση ελέγχεται ήδη στο middleware.

import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { SuperAdminUserProvider } from "./SuperAdminUser";

export const dynamic = "force-dynamic";

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  // Από τη βάση (τρέχουσα τιμή), με εφεδρεία το JWT της συνεδρίας.
  const me = session
    ? await db.user.findUnique({ where: { id: session.userId }, select: { name: true, email: true } })
    : null;
  const user = { name: me?.name ?? session?.name ?? "", email: me?.email ?? session?.email ?? "" };
  return (
    <I18nProvider locale={session?.locale}>
      <SuperAdminUserProvider user={user}>{children}</SuperAdminUserProvider>
    </I18nProvider>
  );
}
