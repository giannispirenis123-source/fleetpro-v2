import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { toBookingDTO } from "@/lib/bookings";
import { toExtraDTO } from "@/lib/extras";
import BookingsClient from "./BookingsClient";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "SUPER_ADMIN") redirect("/super-admin");
  if (!session.tenantId) redirect("/login");

  const tenantId = session.tenantId;

  const [bookings, customers, vehicles, extras, tenant] = await Promise.all([
    db.booking.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: {
        vehicle: { select: { brand: true, model: true, plate: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
    }),
    db.customer.findMany({
      where: { tenantId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
    }),
    db.vehicle.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
      select: {
        id: true,
        brand: true,
        model: true,
        plate: true,
        dailyRate: true,
      },
    }),
    // Μόνο τα ενεργά πρόσθετα προσφέρονται σε νέα κράτηση.
    db.extra.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    db.tenant.findUnique({
      where: { id: tenantId },
      select: { rentalMode: true, prepTimeMinutes: true },
    }),
  ]);

  return (
    <BookingsClient
      initialBookings={bookings.map(toBookingDTO)}
      customers={customers.map((c) => ({
        id: c.id,
        label: `${c.firstName} ${c.lastName}`,
      }))}
      vehicles={vehicles.map((v) => ({
        id: v.id,
        label: `${v.brand} ${v.model} · ${v.plate}`,
        // Decimal → number πριν περάσει σε client component.
        dailyRate: Number(v.dailyRate),
      }))}
      extras={extras.map(toExtraDTO)}
      tenantId={tenantId}
      rentalMode={tenant?.rentalMode ?? "BOOKING"}
      prepMinutes={tenant?.prepTimeMinutes ?? 0}
      role={session.role}
    />
  );
}
