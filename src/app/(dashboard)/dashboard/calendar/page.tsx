import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { toBookingDTO } from "@/lib/bookings";
import { addDays, firstDay, lastDay, normalizeMonth } from "@/lib/calendar";
import CalendarClient from "./CalendarClient";

export const dynamic = "force-dynamic";

const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

export default async function CalendarPage({
  searchParams,
}: {
  searchParams?: { m?: string; view?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "SUPER_ADMIN") redirect("/super-admin");
  if (!session.tenantId) redirect("/login");

  const tenantId = session.tenantId;
  const month = normalizeMonth(searchParams?.m);
  const from = firstDay(month);
  const to = lastDay(month);

  const [bookings, vehicles] = await Promise.all([
    // Μόνο όσες αγγίζουν τον ορατό μήνα: παραλαβή πριν το τέλος του και
    // επιστροφή μετά την αρχή του. Έτσι πιάνονται και οι κρατήσεις που
    // ξεκινούν ή τελειώνουν έξω από τον μήνα, χωρίς να φέρουμε όλο το
    // ιστορικό της εταιρίας.
    //
    // Το πάνω όριο είναι η ΑΡΧΗ της επόμενης ημέρας, όχι τα μεσάνυχτα της
    // τελευταίας: οι στήλες είναι timestamp και υπάρχουν εγγραφές με ώρα
    // μέσα στην ημέρα. Με `lte` στα μεσάνυχτα, μια κράτηση που ξεκινά την
    // τελευταία μέρα του μήνα στις 09:41 θα έλειπε αθόρυβα.
    db.booking.findMany({
      where: {
        tenantId,
        pickupDate: { lt: toDate(addDays(to, 1)) },
        returnDate: { gte: toDate(from) },
      },
      orderBy: [{ pickupDate: "asc" }, { bookingNumber: "asc" }],
      include: {
        vehicle: { select: { brand: true, model: true, plate: true } },
        customer: { select: { firstName: true, lastName: true } },
        invoice: { select: { invoiceNumber: true } },
      },
    }),
    db.vehicle.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
      select: { id: true, brand: true, model: true, plate: true },
    }),
  ]);

  return (
    <CalendarClient
      month={month}
      initialView={searchParams?.view === "timeline" ? "timeline" : "month"}
      bookings={bookings.map(toBookingDTO)}
      vehicles={vehicles.map((v) => ({
        id: v.id,
        name: `${v.brand} ${v.model}`,
        plate: v.plate,
      }))}
      role={session.role}
    />
  );
}
