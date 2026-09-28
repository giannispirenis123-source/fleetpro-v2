import { redirect } from "next/navigation";
import { pageGuard, viewerCan } from "@/lib/authz";
import { db } from "@/lib/db";
import {
  SERVICE_INCLUDE,
  DAMAGE_INCLUDE,
  toServiceDTO,
  toDamageDTO,
} from "@/lib/service";
import ServiceClient from "./ServiceClient";

export const dynamic = "force-dynamic";

export default async function ServicePage() {
  // Η σελίδα έχει δύο ενότητες· αρκεί να μπορεί να δει τη μία.
  const guard = (await pageGuard("service.view")) ?? (await pageGuard("damages.view"));
  if (!guard) redirect("/dashboard");
  const { session, viewer } = guard;

  const tenantId = session.tenantId;

  const [records, damages, vehicles, bookings] = await Promise.all([
    viewerCan(viewer, "service.view")
      ? db.serviceRecord.findMany({
          where: { tenantId },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          include: SERVICE_INCLUDE,
        })
      : [],
    viewerCan(viewer, "damages.view")
      ? db.damage.findMany({
          where: { tenantId },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          include: DAMAGE_INCLUDE,
        })
      : [],
    db.vehicle.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
      select: { id: true, brand: true, model: true, plate: true },
    }),
    // Οι κρατήσεις για το dropdown της ζημιάς. Φιλτράρονται στον client
    // ανά όχημα, ώστε να μη χρειάζεται δεύτερη κλήση σε κάθε επιλογή.
    db.booking.findMany({
      where: { tenantId },
      orderBy: { pickupDate: "desc" },
      take: 300,
      select: {
        id: true,
        bookingNumber: true,
        vehicleId: true,
        pickupDate: true,
        customer: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  return (
    <ServiceClient
      initialRecords={records.map(toServiceDTO)}
      initialDamages={damages.map(toDamageDTO)}
      vehicles={vehicles.map((v) => ({
        id: v.id,
        label: `${v.brand} ${v.model} · ${v.plate}`,
      }))}
      bookings={bookings.map((b) => ({
        id: b.id,
        vehicleId: b.vehicleId,
        label: `${b.bookingNumber} · ${b.customer.firstName} ${b.customer.lastName} · ${b.pickupDate.toISOString().slice(0, 10)}`,
      }))}
      can={{
        serviceView: viewerCan(viewer, "service.view"),
        serviceCreate: viewerCan(viewer, "service.create"),
        serviceEdit: viewerCan(viewer, "service.edit"),
        serviceDelete: viewerCan(viewer, "service.delete"),
        damagesView: viewerCan(viewer, "damages.view"),
        damagesCreate: viewerCan(viewer, "damages.create"),
        damagesEdit: viewerCan(viewer, "damages.edit"),
        damagesDelete: viewerCan(viewer, "damages.delete"),
      }}
    />
  );
}
