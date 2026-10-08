import { notFound, redirect } from "next/navigation";
import { pageGuard, viewerCan } from "@/lib/authz";
import { ADMIN_ROLE } from "@/lib/adminRole";
import { db } from "@/lib/db";
import { loadContract, refreshDraftSnapshot, tenantLocations, tenantLogoUrl } from "@/lib/contractForm";
import { toExtraDTO } from "@/lib/extras";
import { canSendContractEmail } from "@/lib/contractEmailSend";
import ContractEditor from "./ContractEditor";

export const dynamic = "force-dynamic";

export default async function ContractPage({ params }: { params: { id: string } }) {
  const guard = await pageGuard("contracts.view");
  if (!guard) redirect("/dashboard");
  const { session, viewer } = guard;

  await refreshDraftSnapshot(viewer, params.id);

  const [contract, vehicles, extras, tenant, logoUrl, locations, emailSent] = await Promise.all([
    loadContract(viewer, params.id),
    // Για την αλλαγή οχήματος: μόνο τα ενεργά οχήματα του στόλου.
    db.vehicle.findMany({
      where: { tenantId: session.tenantId, isActive: true },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
      select: { id: true, brand: true, model: true, plate: true, dailyRate: true },
    }),
    // Τα πρόσθετα της εταιρίας για την ενότητα «Πρόσθετα / Extras».
    db.extra.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    db.tenant.findUnique({
      where: { id: session.tenantId },
      select: { vatRate: true, roundUpTotal: true },
    }),
    tenantLogoUrl(session.tenantId!),
    tenantLocations(session.tenantId!),
    // Τελευταία αποστολή στον πελάτη (email + PDF).
    db.contract.findFirst({
      where: { id: params.id, tenantId: session.tenantId },
      select: { emailSentAt: true, emailSentTo: true },
    }),
  ]);
  if (!contract) notFound();

  return (
    <ContractEditor
      initialContract={contract}
      vehicles={vehicles.map((v) => ({
        id: v.id,
        brand: v.brand,
        model: v.model,
        plate: v.plate,
        dailyRate: Number(v.dailyRate),
      }))}
      extras={extras.map(toExtraDTO)}
      vatRate={Number(tenant?.vatRate ?? 24)}
      roundUpTotal={tenant?.roundUpTotal ?? false}
      logoUrl={logoUrl}
      locations={locations}
      emailSent={
        emailSent?.emailSentAt
          ? { sentAt: emailSent.emailSentAt.toISOString(), sentTo: emailSent.emailSentTo ?? "" }
          : null
      }
      can={{
        edit: viewerCan(viewer, "contracts.edit"),
        delete: viewerCan(viewer, "contracts.delete"),
        price: viewerCan(viewer, "contracts.price"),
        // Πλήρης αριθμός κάρτας: ΜΟΝΟ Διαχειριστής εταιρίας.
        revealCard: viewer.role === ADMIN_ROLE,
        // Αποστολή στον πελάτη: Διαχειριστής και Προσωπικό, όχι συνεργάτης.
        sendEmail: canSendContractEmail(viewer.role),
      }}
    />
  );
}
