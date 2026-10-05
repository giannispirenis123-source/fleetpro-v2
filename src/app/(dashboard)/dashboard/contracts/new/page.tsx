import { redirect } from "next/navigation";
import { pageGuard, viewerCan } from "@/lib/authz";
import { db } from "@/lib/db";
import { toExtraDTO } from "@/lib/extras";
import { listPartners } from "@/lib/partners";
import { tenantLogoUrl } from "@/lib/contractForm";
import ContractEditor from "../[id]/ContractEditor";

export const dynamic = "force-dynamic";

// «+ Νέο συμβόλαιο»: ανοίγει ΚΑΤΕΥΘΕΙΑΝ το ηλεκτρονικό συμβόλαιο σε
// κατάσταση «νέο» (walk-in). Τίποτα δεν γράφεται πριν την πρώτη
// αποθήκευση. Τα ΙΔΙΑ δικαιώματα με το API: contracts.create ΚΑΙ bookings.create.
export default async function NewContractPage() {
  const guard = await pageGuard("contracts.create");
  if (!guard || !viewerCan(guard.viewer, "bookings.create")) redirect("/dashboard/contracts");
  const { session, viewer } = guard;
  const isPartner = viewer.role === "PARTNER";

  const [extras, partners, vehicles, tenant, logoUrl] = await Promise.all([
    // Μόνο τα ενεργά πρόσθετα προσφέρονται σε νέα κράτηση.
    db.extra.findMany({
      where: { tenantId: session.tenantId, isActive: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    // Ο συνεργάτης χρεώνεται πάντα τον εαυτό του: δεν βλέπει λίστα.
    isPartner ? Promise.resolve([]) : listPartners(session.tenantId),
    // Για την αλλαγή οχήματος μετά την αποθήκευση.
    db.vehicle.findMany({
      where: { tenantId: session.tenantId, isActive: true },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
      select: { id: true, brand: true, model: true, plate: true },
    }),
    db.tenant.findUnique({
      where: { id: session.tenantId },
      select: { vatRate: true, roundUpTotal: true },
    }),
    tenantLogoUrl(session.tenantId!),
  ]);

  return (
    <ContractEditor
      initialContract={null}
      vehicles={vehicles.map((v) => ({ id: v.id, label: `${v.brand} ${v.model} · ${v.plate}` }))}
      extras={extras.map(toExtraDTO)}
      vatRate={Number(tenant?.vatRate ?? 24)}
      roundUpTotal={tenant?.roundUpTotal ?? false}
      logoUrl={logoUrl}
      can={{
        edit: viewerCan(viewer, "contracts.edit"),
        delete: viewerCan(viewer, "contracts.delete"),
      }}
      walkIn={{
        partners: partners.map((p) => ({ id: p.id, name: p.name })),
        canOverride: viewerCan(viewer, "bookings.override"),
      }}
    />
  );
}
