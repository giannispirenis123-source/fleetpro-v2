import { redirect } from "next/navigation";
import { pageGuard, bookingScope, viewerCan } from "@/lib/authz";
import { listPartners } from "@/lib/partners";
import { db } from "@/lib/db";
import { loadBookingForList, loadBookingPage, myCommissionSettings } from "@/lib/listServer";
import { toExtraDTO } from "@/lib/extras";
import { expireStaleHolds } from "@/lib/public/paymentServer";
import { stripeLiveMode } from "@/lib/stripeConnect";
import BookingsClient from "./BookingsClient";

export const dynamic = "force-dynamic";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams?: { booking?: string; status?: string };
}) {
  // Ο φύλακας διαβάζει το ΙΔΙΟ κλειδί με το API: καμία σελίδα δεν δείχνει
  // κάτι που ο server θα αρνιόταν.
  const guard = await pageGuard("bookings.view");
  if (!guard) redirect("/dashboard");
  const { session, viewer } = guard;

  const tenantId = session.tenantId;
  // Αναμονές online πληρωμής που έληξαν χωρίς webhook → ακυρωμένες, πριν τη λίστα.
  if (tenantId) await expireStaleHolds(db, tenantId);

  const [initialPage, customers, vehicles, extras, tenant, partners, me, focusBooking] =
    await Promise.all([
    // Πρώτη σελίδα (50) — με το φίλτρο «Εκκρεμεί» αν ήρθαμε από το banner.
    // Σύνοψη προμήθειας σε ΟΛΕΣ τις κρατήσεις του χρήστη (listServer.ts).
    myCommissionSettings(viewer, viewerCan(viewer, "commission.view")).then((settings) =>
      loadBookingPage(viewer, { status: searchParams?.status === "PENDING" ? "PENDING" : undefined }, settings)
    ),
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
    // Οι δικές ΜΟΥ ρυθμίσεις προμήθειας — ισχύουν για συνεργάτη και για
    // προσωπικό. Με ποσοστό 0 δεν εμφανίζεται τίποτα.
    db.user.findUnique({
      where: { id: viewer.userId },
      select: {
        commissionRate: true,
        commissionOnRental: true,
        commissionOnExtras: true,
        commissionOnInsurance: true,
      },
    }),
    // Από το Ημερολόγιο / ειδοποίηση: η κράτηση μπορεί να μην είναι στην πρώτη σελίδα.
    searchParams?.booking ? loadBookingForList(viewer, searchParams.booking) : null,
  ]);

  return (
    <BookingsClient
      initialPage={initialPage}
      focusBooking={focusBooking}
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
      stripeLive={stripeLiveMode()}
      partners={partners}
      currentUserId={viewer.userId}
      myCommission={{
        rate: Number(me?.commissionRate ?? 0),
        onRental: me?.commissionOnRental ?? true,
        onExtras: me?.commissionOnExtras ?? false,
        onInsurance: me?.commissionOnInsurance ?? false,
      }}
      canSeeCommission={viewerCan(viewer, "commission.view")}
      canContract={viewerCan(viewer, "contracts.view")}
      // Από το Ημερολόγιο: ποια κράτηση να ανοίξει μόλις φορτώσει η σελίδα.
      initialStatus={searchParams?.status === "PENDING" ? "PENDING" : undefined}
      focusBookingId={searchParams?.booking ?? null}
    />
  );
}
