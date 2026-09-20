import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { toVehicleDTO } from "@/lib/vehicles";
import FleetClient from "./FleetClient";

export const dynamic = "force-dynamic";

export default async function FleetPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "SUPER_ADMIN") redirect("/super-admin");
  if (!session.tenantId) redirect("/login");

  // Αρχική λίστα από τη βάση: η σελίδα έρχεται ήδη γεμάτη, χωρίς loading state.
  // Από εκεί και πέρα τη λίστα τη συντηρεί ο client μετά από κάθε αλλαγή.
  const vehicles = await db.vehicle.findMany({
    where: { tenantId: session.tenantId, isActive: true },
    orderBy: [{ brand: "asc" }, { model: "asc" }],
  });

  return (
    <FleetClient
      initialVehicles={vehicles.map(toVehicleDTO)}
      role={session.role}
    />
  );
}
