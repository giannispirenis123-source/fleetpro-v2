export const dynamic = "force-dynamic";
// src/app/api/bookings/route.ts
// Κρατήσεις ανά tenant — Βήμα 1: λίστα και δημιουργία.
//
// ΔΕΝ γίνεται ακόμη: υπολογισμός τιμής με extras/εκπτώσεις, έλεγχος
// επικάλυψης ημερομηνιών, αυτόματο τιμολόγιο. Έρχονται στο Βήμα 2.

import { z } from "zod";
import { db } from "@/lib/db";
import {
  withAuth,
  ok,
  created,
  badRequest,
  serverError,
} from "@/lib/api";
import {
  BOOKING_STATUSES,
  RESERVING_STATUSES,
  countDays,
  toBookingDTO,
} from "@/lib/bookings";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Μορφή ημερομηνίας: YYYY-MM-DD");

const createBookingSchema = z.object({
  customerId: z.string().min(1, "Απαιτείται πελάτης"),
  vehicleId: z.string().min(1, "Απαιτείται όχημα"),
  pickupDate: isoDate,
  returnDate: isoDate,
  status: z.enum(BOOKING_STATUSES).optional(),
  notes: z.union([z.string(), z.null()]).optional(),
});

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

/** BP-2025-001, αυξανόμενο ανά εταιρία και έτος. */
async function nextBookingNumber(tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `BP-${year}-`;

  const last = await db.booking.findFirst({
    where: { tenantId, bookingNumber: { startsWith: prefix } },
    orderBy: { bookingNumber: "desc" },
    select: { bookingNumber: true },
  });

  const lastSeq = last ? parseInt(last.bookingNumber.slice(prefix.length), 10) : 0;
  const next = (Number.isNaN(lastSeq) ? 0 : lastSeq) + 1;

  return `${prefix}${String(next).padStart(3, "0")}`;
}

// GET /api/bookings
export const GET = withAuth(
  async (req, session) => {
    try {
      const url = new URL(req.url);
      const status = url.searchParams.get("status");

      const bookings = await db.booking.findMany({
        where: {
          tenantId: session.tenantId!,
          ...(status ? { status: status as never } : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          vehicle: { select: { brand: true, model: true, plate: true } },
          customer: { select: { firstName: true, lastName: true } },
        },
      });

      return ok(bookings.map(toBookingDTO));
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN", "STAFF", "PARTNER"]
);

// POST /api/bookings
export const POST = withAuth(
  async (req, session) => {
    try {
      const body = await req.json();
      const parsed = createBookingSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;

      if (data.returnDate < data.pickupDate) {
        return badRequest("Η επιστροφή δεν μπορεί να προηγείται της παραλαβής");
      }

      // Πελάτης και όχημα πρέπει να ανήκουν στην ίδια εταιρία με τον χρήστη.
      const [customer, vehicle, tenant] = await Promise.all([
        db.customer.findFirst({
          where: { id: data.customerId, tenantId: session.tenantId! },
          select: { id: true },
        }),
        db.vehicle.findFirst({
          where: { id: data.vehicleId, tenantId: session.tenantId! },
          select: { id: true, dailyRate: true },
        }),
        db.tenant.findUnique({
          where: { id: session.tenantId! },
          select: { rentalMode: true },
        }),
      ]);

      if (!customer) return badRequest("Ο πελάτης δεν βρέθηκε");
      if (!vehicle) return badRequest("Το όχημα δεν βρέθηκε");
      if (!tenant) return badRequest("Η εταιρία δεν βρέθηκε");

      // Σε λειτουργία REQUEST κάθε νέα εγγραφή είναι αίτημα: μπαίνει PENDING
      // ανεξάρτητα από το τι ζήτησε η φόρμα, και το όχημα δεν δεσμεύεται.
      const status =
        tenant.rentalMode === "REQUEST" ? "PENDING" : data.status ?? "PENDING";

      const totalDays = countDays(data.pickupDate, data.returnDate);
      const dailyRate = Number(vehicle.dailyRate);
      const subtotal = dailyRate * totalDays;

      const booking = await db.booking.create({
        data: {
          tenantId: session.tenantId!,
          customerId: customer.id,
          vehicleId: vehicle.id,
          bookingNumber: await nextBookingNumber(session.tenantId!),
          status,
          pickupDate: toDate(data.pickupDate),
          returnDate: toDate(data.returnDate),
          // Βήμα 1: η τιμή είναι απλώς ημερήσια × ημέρες, ώστε να καλυφθούν
          // τα υποχρεωτικά πεδία. Ο πλήρης υπολογισμός έρχεται στο Βήμα 2.
          dailyRate,
          totalDays,
          subtotal,
          total: subtotal,
          notes: data.notes?.trim() || null,
        },
        include: {
          vehicle: { select: { brand: true, model: true, plate: true } },
          customer: { select: { firstName: true, lastName: true } },
        },
      });

      // Δέσμευση οχήματος μόνο όταν η κράτηση ξεκινά ήδη δεσμευτική.
      if (RESERVING_STATUSES.includes(status)) {
        await db.vehicle.update({
          where: { id: vehicle.id },
          data: { status: "RENTED" },
        });
      }

      return created({ booking: toBookingDTO(booking) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN", "STAFF"]
);
