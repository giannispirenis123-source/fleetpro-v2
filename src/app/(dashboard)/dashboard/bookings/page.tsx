import { redirect } from "next/navigation";
import { pageGuard, bookingScope } from "@/lib/authz";
import { listPartners } from "@/lib/partners";
import { db } from "@/lib/db";
import { toBookingDTO } from "@/lib/bookings";
import { toExtraDTO } from "@/lib/extras";
import BookingsClient from "./BookingsClient";

export const dynamic = "force-dynamic";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams?: { booking?: string };
}) {
  // Ο φύλακας διαβάζει το ΙΔΙΟ κλειδί με το API: καμία σελίδα δεν δείχνει
  // κάτι που ο server θα αρνιόταν.
  const guard = await pageGuard("bookings.view");
  if (!guard) redirect("/dashboard");
  const { session, viewer } = guard;

  const tenantId = session.tenantId;

  const [bookings, customers, vehicles, extras, tenant, partners] = await Promise.all([
    db.booking.findMany({
      // Ο συνεργάτης βλέπει ΜΟΝΟ τις δικές του — φιλτράρεται στη βάση.
      where: bookingScope(viewer),
      orderBy: { createdAt: "desc" },
      include: {
        vehicle: { select: { brand: true, model: true, plate: true } },
        customer: { select: { firstName: true, lastName: true } },
        invoice: { select: { invoiceNumber: true } },
        partner: { select: { id: true, name: true, commissionRate: true } },
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
      select: {
        rentalMode: true,
        prepTimeMinutes: true,
        roundUpTotal: true,
      },
    }),
    listPartners(tenantId),
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
      roundUpTotal={tenant?.roundUpTotal ?? false}
      role={session.role}
      partners={partners}
      myCommissionRate={
        partners.find((p) => p.id === viewer.userId)?.commissionRate ?? 0
      }
      // Από το Ημερολόγιο: ποια κράτηση να ανοίξει μόλις φορτώσει η σελίδα.
      focusBookingId={searchParams?.booking ?? null}
    />
  );
}
