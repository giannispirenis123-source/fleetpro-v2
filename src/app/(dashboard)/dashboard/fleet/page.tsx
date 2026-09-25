import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { db } from "@/lib/db";
import { toVehicleDTO } from "@/lib/vehicles";
import FleetClient from "./FleetClient";

export const dynamic = "force-dynamic";

export default async function FleetPage() {
  // Ο φύλακας διαβάζει το ΙΔΙΟ κλειδί με το API: καμία σελίδα δεν δείχνει
  // κάτι που ο server θα αρνιόταν.
  const guard = await pageGuard("fleet.view");
  if (!guard) redirect("/dashboard");
  const { session } = guard;

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
