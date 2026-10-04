export const dynamic = "force-dynamic";
// src/app/api/bookings/route.ts
// Κρατήσεις ανά tenant — λίστα και δημιουργία.
//
// Η τιμή ΔΕΝ έρχεται ποτέ από τη φόρμα: ο client στέλνει μόνο ids και
// επιλογές, και το priceBooking() την ξαναβγάζει από τη βάση.
//
// ΔΕΝ γίνεται ακόμη: ΦΠΑ και αυτόματο τιμολόγιο — σελίδα Τιμολογίων.

import { db } from "@/lib/db";
import { ok, created, badRequest, serverError } from "@/lib/api";
import { withPermission, bookingScope } from "@/lib/authz";
import { toBookingDTO } from "@/lib/bookings";
import {
  createBookingSchema,
  prepareBooking,
  writeBooking,
} from "@/lib/bookingCreate";

// GET /api/bookings
export const GET = withPermission(
  async (req, session, _params, viewer) => {
    try {
      const url = new URL(req.url);
      const status = url.searchParams.get("status");

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
          invoice: { select: { invoiceNumber: true } },
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
      console.error(error);
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
      const booking = await db.$transaction((tx) =>
        writeBooking(tx, plan, plan.customerId!)
      );

      return created({ booking: toBookingDTO(booking) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "bookings.create"
);
