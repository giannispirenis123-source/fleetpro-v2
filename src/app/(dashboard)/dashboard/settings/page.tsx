import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "SUPER_ADMIN") redirect("/super-admin");
  if (!session.tenantId) redirect("/login");

  // Οι ρυθμίσεις της εταιρίας αλλάζουν μόνο από τον διαχειριστή της.
  if (session.role !== "COMPANY_ADMIN") redirect("/dashboard");

  const tenant = await db.tenant.findUnique({
    where: { id: session.tenantId },
    select: { name: true, rentalMode: true },
  });
  if (!tenant) redirect("/dashboard");

  return (
    <SettingsClient
      companyName={tenant.name}
      initialRentalMode={tenant.rentalMode}
    />
  );
}
