import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { db } from "@/lib/db";
import { toVehicleDTO } from "@/lib/vehicles";
import { checkWithinLimit, getEntitlements } from "@/lib/entitlements";
import { readLocalized } from "@/lib/public/text";
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
  const [vehicles, entitlements, limit, groups] = await Promise.all([
    db.vehicle.findMany({
      where: { tenantId: session.tenantId, isActive: true },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
    }),
    getEntitlements(session.tenantId),
    checkWithinLimit(session.tenantId, "vehicles"),
    db.rentalGroup.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, isActive: true },
    }),
  ]);

  return (
    <FleetClient
      initialVehicles={vehicles.map(toVehicleDTO)}
      role={session.role}
      limitMessage={limit.ok ? null : limit.message}
      publicSite={entitlements.modules.publicSite}
      groups={groups.map((g) => ({
        id: g.id,
        label: `${g.code} · ${readLocalized(g.name).el ?? ""}`.trim(),
        isActive: g.isActive,
      }))}
    />
  );
}
