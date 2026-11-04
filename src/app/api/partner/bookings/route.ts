export const dynamic = "force-dynamic";
// src/app/api/partner/bookings/route.ts
// Κράτηση από τον συνεργάτη, από το dashboard του.
//
// · Μόνο συνεργάτης με «partner.book» (403 αλλιώς — και με απευθείας κλήση).
// · Ίδια ροή με κάθε κράτηση: prepareBooking (τιμή ΜΟΝΟ από τον server μέσω
//   priceBooking → quote με τους ελέγχους ακεραιότητας) → writeBooking (ίδιο
//   advisory lock + επανέλεγχος σύγκρουσης). Ο συνεργάτης ΔΕΝ ορίζει τιμή,
//   έκπτωση, κατάσταση ή συνεργάτη: PENDING, στο όνομά του, χωρίς έκπτωση.
// · Το όχημα πρέπει να είναι στα ΔΙΑΘΕΣΙΜΑ του διαστήματος (ίδια λογική με τη
//   φόρμα του προσωπικού — loadPartnerVehicles/loadWalkInVehicles)· αλλιώς, ή
//   αν το πήρε κάποιος στο μεταξύ → 409 code "vehicle_unavailable" με σαφές
//   μήνυμα (κανένα στοιχείο άλλης κράτησης) και η φόρμα ξαναφορτώνει τη λίστα.
// · Πρόσθετα/ασφάλεια όπως στη φόρμα του προσωπικού (ids· τιμή από τον server).
// · Πελάτης: υπάρχων ΜΟΝΟ με ίδιο email/τηλέφωνο ΚΑΙ ίδιο ονοματεπώνυμο
//   (matchPartnerCustomer), αλλιώς νέος· ο συνεργάτης δεν μαθαίνει ποιο ισχύει.
// · Όριο κρατήσεων ανά συνεργάτη (rate limit). Μόνο ανάγνωση συνδρομής: 403
//   από το withAuth όπως σε κάθε εγγραφή.
// · { preview: true } = μόνο τιμή/διαθεσιμότητα, χωρίς εγγραφή.

import { z } from "zod";
import { db } from "@/lib/db";
import { badRequest, created, forbidden, logError, ok, serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { withPermission } from "@/lib/authz";
import { TIME_RE } from "@/lib/bookings";
import { BookingConflictError, prepareBooking, writeBooking } from "@/lib/bookingCreate";
import { withBookingNumberRetry } from "@/lib/bookingNumberRetry";
import { commissionFor, NO_COMMISSION } from "@/lib/commission";
import { myCommissionSettings } from "@/lib/listServer";
import { NO_PRICE_MESSAGE } from "@/lib/public/engine";
import { storedTotalCents } from "@/lib/public/money";
import { hitLimit, LIMITS } from "@/lib/public/rateLimit";
import { dbCounterStore } from "@/lib/public/rateLimitStore";
import { isPartnerViewer, loadPartnerVehicles, matchPartnerCustomer } from "@/lib/partnerServer";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);

const schema = z.object({
  vehicleId: z.string().min(1).max(64),
  pickupDate: isoDate,
  pickupTime: z.string().regex(TIME_RE),
  returnDate: isoDate,
  returnTime: z.string().regex(TIME_RE),
  pickupLocation: z.union([text(200), z.null()]).optional(),
  returnLocation: z.union([text(200), z.null()]).optional(),
  driverBirthDate: z.union([isoDate, z.null()]).optional(),
  notes: z.union([text(1000), z.null()]).optional(),
  /** Πρόσθετα ΚΑΙ ασφάλεια (ids του καταλόγου της εταιρίας· ο server τα ελέγχει/τιμολογεί). */
  extraIds: z.array(z.string().min(1).max(64)).max(30).optional(),
  customer: z
    .object({
      firstName: text(80).min(1, "Απαιτείται όνομα"),
      lastName: text(80).min(1, "Απαιτείται επώνυμο"),
      phone: z.union([text(40), z.null()]).optional(),
      email: z.union([z.string().trim().email("Μη έγκυρο email").max(200), z.literal(""), z.null()]).optional(),
    })
    .optional(),
  preview: z.boolean().optional(),
});

const UNAVAILABLE = {
  message: "Το όχημα δεν είναι πια διαθέσιμο σε αυτό το διάστημα. Η λίστα ανανεώθηκε — διάλεξε άλλο όχημα.",
  code: "vehicle_unavailable",
} as const;
const unavailable = () => NextResponse.json({ success: false, ...UNAVAILABLE }, { status: 409 });

// POST /api/partner/bookings
export const POST = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      if (!isPartnerViewer(viewer)) return forbidden("Μόνο για συνεργάτες");
      const parsed = schema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      const data = parsed.data;
      if (!data.preview && !data.customer) return badRequest("Απαιτούνται τα στοιχεία του πελάτη");
      if (`${data.returnDate}T${data.returnTime}` <= `${data.pickupDate}T${data.pickupTime}`) {
        return badRequest("Η επιστροφή πρέπει να είναι μετά την παραλαβή");
      }

      // Το όχημα ΠΡΕΠΕΙ να είναι στα διαθέσιμα του διαστήματος (ίδια λίστα με τη φόρμα):
      // κατειλημμένο, σε service ή ανενεργό → 409, ακόμη και με απευθείας κλήση.
      const free = await loadPartnerVehicles(viewer, data);
      if (!free.some((v) => v.id === data.vehicleId)) return unavailable();

      // ΜΟΝΟ ό,τι επιτρέπεται: κανένα ποσό, έκπτωση, κατάσταση ή συνεργάτης από το body.
      // preview: true στο prepareBooking = η σύγκρουση ΔΕΝ επιστρέφει λεπτομέρειες
      // άλλων κρατήσεων· τη χειριζόμαστε εδώ με γενικό μήνυμα.
      const prepared = await prepareBooking({
        viewer,
        data: {
          customerId: null,
          vehicleId: data.vehicleId,
          pickupDate: data.pickupDate,
          pickupTime: data.pickupTime,
          returnDate: data.returnDate,
          returnTime: data.returnTime,
          pickupLocation: data.pickupLocation ?? null,
          returnLocation: data.returnLocation ?? null,
          ...(data.driverBirthDate !== undefined && { driverBirthDate: data.driverBirthDate }),
          notes: data.notes ?? null,
          extraIds: data.extraIds ?? [],
          discountMode: "NONE",
        },
        forceStatus: "PENDING",
        source: "partner",
        preview: true,
      });
      if (!prepared.ok) return prepared.response;
      const { plan, conflicts } = prepared;
      if (conflicts.length > 0) return unavailable();
      if (!plan.autoPrice) return badRequest(NO_PRICE_MESSAGE.el);
      // Δεύτερη δικλείδα: η κράτηση είναι ΠΑΝΤΑ του ίδιου, χωρίς αποδοχή σύγκρουσης.
      if (plan.partnerId !== viewer.userId || plan.conflictsAccepted) return forbidden();

      const settings = (await myCommissionSettings(viewer, true)) ?? NO_COMMISSION;
      const commissionCents = Math.round(
        commissionFor(
          { subtotal: plan.breakdown.subtotal, extrasTotal: plan.breakdown.extrasTotal, insuranceCost: plan.breakdown.insuranceCost },
          settings
        ) * 100
      );
      const totalCents = plan.quote.totalCents;

      if (data.preview) return ok({ totalCents, commissionCents, days: plan.breakdown.totalDays });

      if (!(await hitLimit(dbCounterStore, LIMITS.partnerBookingPerUser, viewer.userId))) {
        return NextResponse.json({ success: false, message: "Πολλές κρατήσεις σε λίγο χρόνο. Δοκιμάστε ξανά αργότερα." }, { status: 429 });
      }

      const c = data.customer!;
      // Ίδιος πελάτης (email/τηλέφωνο + ονοματεπώνυμο) → ο υπάρχων, χωρίς αλλαγή του.
      const existingId = await matchPartnerCustomer(viewer.tenantId, c);
      const booking = await withBookingNumberRetry(() =>
        db.$transaction(async (tx) => {
          const customerId =
            existingId ??
            (
              await tx.customer.create({
                data: {
                  tenantId: viewer.tenantId,
                  firstName: c.firstName,
                  lastName: c.lastName,
                  phone: c.phone || null,
                  email: c.email ? c.email.toLowerCase() : null,
                },
                select: { id: true },
              })
            ).id;
          return writeBooking(tx, plan, customerId);
        })
      );

      return created({
        booking: {
          id: booking.id,
          bookingNumber: booking.bookingNumber,
          status: booking.status,
          totalCents: storedTotalCents(booking.priceQuote, booking.total),
          commissionCents,
        },
      });
    } catch (error) {
      if (error instanceof BookingConflictError) return unavailable();
      logError("partner/bookings", error);
      return serverError();
    }
  },
  "partner.book"
);
