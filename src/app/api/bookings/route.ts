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
import { withPermission, viewerCan } from "@/lib/authz";
import { loadBookingPage, myCommissionSettings } from "@/lib/listServer";
import { BOOKING_STATUSES, toBookingDTO } from "@/lib/bookings";
import { withBookingNumberRetry } from "@/lib/bookingNumberRetry";
import {
  createBookingSchema,
  prepareBooking,
  writeBooking,
  BookingConflictError,
} from "@/lib/bookingCreate";

// GET /api/bookings?status=&q=&mine=1&page=
export const GET = withPermission(
  async (req, session, _params, viewer) => {
    try {
      const url = new URL(req.url);
      const status = url.searchParams.get("status");
      // Άγνωστη κατάσταση: καθαρό 400, όχι σφάλμα της βάσης (500).
      if (status && !(BOOKING_STATUSES as readonly string[]).includes(status)) {
        return badRequest("Μη έγκυρη κατάσταση κράτησης");
      }

      // Σελίδα (50) με φίλτρο/αναζήτηση στον server· στεγανότητα συνεργάτη μέσα
      // στο bookingScope (listServer.ts). Η σύνοψη προμήθειας σε ΟΛΕΣ.
      const commission = await myCommissionSettings(viewer!, viewerCan(viewer!, "commission.view"));
      const page = await loadBookingPage(
        viewer!,
        { status, q: url.searchParams.get("q"), mine: url.searchParams.get("mine") === "1", page: url.searchParams.get("page") },
        commission
      );
      return ok(page);
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
