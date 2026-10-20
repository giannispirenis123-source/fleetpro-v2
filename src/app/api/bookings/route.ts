export const dynamic = "force-dynamic";
// src/app/api/bookings/route.ts
// Κρατήσεις ανά tenant — λίστα και δημιουργία.
//
// Η τιμή ΔΕΝ έρχεται ποτέ από τη φόρμα: ο client στέλνει μόνο ids και
// επιλογές, και το priceBooking() την ξαναβγάζει από τη βάση.
//
// ΔΕΝ γίνεται ακόμη: ΦΠΑ και αυτόματο τιμολόγιο — σελίδα Τιμολογίων.

import { db } from "@/lib/db";
import { ok, created, badRequest, conflict, serverError, logError } from "@/lib/api";
import { withPermission, bookingScope } from "@/lib/authz";
import { BOOKING_STATUSES, toBookingDTO } from "@/lib/bookings";
import { withBookingNumberRetry } from "@/lib/bookingNumberRetry";
import {
  createBookingSchema,
  prepareBooking,
  writeBooking,
  BookingConflictError,
} from "@/lib/bookingCreate";

// GET /api/bookings
export const GET = withPermission(
  async (req, session, _params, viewer) => {
    try {
      const url = new URL(req.url);
      const status = url.searchParams.get("status");
      // Άγνωστη κατάσταση: καθαρό 400, όχι σφάλμα της βάσης (500).
      if (status && !(BOOKING_STATUSES as readonly string[]).includes(status)) {
        return badRequest("Μη έγκυρη κατάσταση κράτησης");
      }

      const bookings = await db.booking.findMany({
        where: {
          // Ο συνεργάτης βλέπει μόνο τις δικές του — το φίλτρο μπαίνει
          // στο ερώτημα, όχι στην εμφάνιση.
          ...bookingScope(viewer!),
          ...(status ? { status: status as never } : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          vehicle: { select: { brand: true, model: true, plate: true } },
          customer: { select: { firstName: true, lastName: true } },
          invoice: { select: { invoiceNumber: true, invoiceCode: true } },
          partner: {
            select: {
              id: true,
              name: true,
              commissionRate: true,
              commissionOnRental: true,
              commissionOnExtras: true,
              commissionOnInsurance: true,
            },
          },
          createdBy: { select: { id: true, name: true } },
        },
      });

      return ok(bookings.map(toBookingDTO));
    } catch (error) {
      logError("bookings", error);
      return serverError();
    }
  },
  "bookings.view"
);

// POST /api/bookings
// Η λογική ζει στο src/lib/bookingCreate.ts: την ίδια χρησιμοποιεί και το
// γρήγορο συμβόλαιο (walk-in), ώστε οι δύο δρόμοι να μη διαφέρουν ποτέ.
export const POST = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      const body = await req.json();
      const parsed = createBookingSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const prepared = await prepareBooking({ viewer: viewer!, data: parsed.data });
      if (!prepared.ok) return prepared.response;

      const { plan } = prepared;
      // Σύγκρουση στο UNIQUE αριθμού κράτησης → ξανά (όχι 500).
      const booking = await withBookingNumberRetry(() =>
        db.$transaction((tx) => writeBooking(tx, plan, plan.customerId!))
      );

      return created({ booking: toBookingDTO(booking) });
    } catch (error) {
      if (error instanceof BookingConflictError) return conflict(error.message, error.conflicts);
      logError("bookings", error);
      return serverError();
    }
  },
  "bookings.create"
);
