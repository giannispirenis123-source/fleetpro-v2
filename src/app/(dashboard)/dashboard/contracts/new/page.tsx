import { redirect } from "next/navigation";
import { pageGuard, viewerCan } from "@/lib/authz";
import { db } from "@/lib/db";
import { toExtraDTO } from "@/lib/extras";
import { listPartners } from "@/lib/partners";
import WalkInClient from "./WalkInClient";

export const dynamic = "force-dynamic";

// «Νέο συμβόλαιο» χωρίς προϋπάρχουσα κράτηση (walk-in). Τα ΙΔΙΑ
// δικαιώματα με το API: contracts.create ΚΑΙ bookings.create.
export default async function NewContractPage() {
  const guard = await pageGuard("contracts.create");
  if (!guard || !viewerCan(guard.viewer, "bookings.create")) redirect("/dashboard/contracts");
  const { session, viewer } = guard;
  const isPartner = viewer.role === "PARTNER";

  const [extras, partners] = await Promise.all([
    // Μόνο τα ενεργά πρόσθετα προσφέρονται σε νέα κράτηση.
    db.extra.findMany({
      where: { tenantId: session.tenantId, isActive: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    // Ο συνεργάτης χρεώνεται πάντα τον εαυτό του: δεν βλέπει λίστα.
    isPartner ? Promise.resolve([]) : listPartners(session.tenantId),
  ]);

  return (
    <WalkInClient
      extras={extras.map(toExtraDTO)}
      partners={partners.map((p) => ({ id: p.id, name: p.name }))}
      canOverride={viewerCan(viewer, "bookings.override")}
    />
  );
}
