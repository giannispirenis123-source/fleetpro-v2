export const dynamic = "force-dynamic";
// src/app/api/partner/bookings/route.ts
// Κράτηση από τον συνεργάτη, από το dashboard του.
//
// · Μόνο συνεργάτης με «partner.book» (403 αλλιώς — και με απευθείας κλήση).
// · Ίδια ροή με κάθε κράτηση: prepareBooking (τιμή ΜΟΝΟ από τον server μέσω
//   priceBooking → quote με τους ελέγχους ακεραιότητας) → writeBooking (ίδιο
//   advisory lock + επανέλεγχος σύγκρουσης). Ο συνεργάτης ΔΕΝ ορίζει τιμή,
//   έκπτωση, κατάσταση ή συνεργάτη: PENDING, στο όνομά του, χωρίς έκπτωση.
// · Σύγκρουση → 409 με γενικό μήνυμα (κανένα στοιχείο άλλης κράτησης).
// · Όριο κρατήσεων ανά συνεργάτη (rate limit). Μόνο ανάγνωση συνδρομής: 403
//   από το withAuth όπως σε κάθε εγγραφή.
// · { preview: true } = μόνο τιμή/διαθεσιμότητα, χωρίς εγγραφή.

import { z } from "zod";
import { db } from "@/lib/db";
import { badRequest, conflict, created, forbidden, logError, ok, serverError } from "@/lib/api";
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
import { isPartnerViewer } from "@/lib/partnerServer";

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

const PARTNER_CONFLICT_MESSAGE = "Το όχημα δεν είναι διαθέσιμο σε αυτό το διάστημα.";

// POST /api/partner/bookings
export const POST = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      if (!isPartnerViewer(viewer)) return forbidden("Μόνο για συνεργάτες");
      const parsed = schema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      const data = parsed.data;
      if (!data.preview && !data.customer) return badRequest("Απαιτούνται τα στοιχεία του πελάτη");

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
          extraIds: [],
          discountMode: "NONE",
        },
        forceStatus: "PENDING",
        source: "partner",
        preview: true,
      });
      if (!prepared.ok) return prepared.response;
      const { plan, conflicts } = prepared;
      if (conflicts.length > 0) return conflict(PARTNER_CONFLICT_MESSAGE);
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
      const booking = await withBookingNumberRetry(() =>
        db.$transaction(async (tx) => {
          // Νέος πελάτης ΜΟΝΟ με όσα έδωσε ο συνεργάτης (δεν βλέπει τη λίστα πελατών της εταιρίας).
          const customer = await tx.customer.create({
            data: {
              tenantId: viewer.tenantId,
              firstName: c.firstName,
              lastName: c.lastName,
              phone: c.phone || null,
              email: c.email ? c.email.toLowerCase() : null,
            },
            select: { id: true },
          });
          return writeBooking(tx, plan, customer.id);
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
      if (error instanceof BookingConflictError) return conflict(PARTNER_CONFLICT_MESSAGE);
      logError("partner/bookings", error);
      return serverError();
    }
  },
  "partner.book"
);
