export const dynamic = "force-dynamic";
// src/app/api/contracts/walk-in/route.ts
// Γρήγορο συμβόλαιο χωρίς προϋπάρχουσα κράτηση.
//
// GET  → τα διαθέσιμα οχήματα για το διάστημα.
// POST → { preview: true } μόνο τιμή/σύγκρουση· αλλιώς σε ΜΙΑ transaction
//        νέος πελάτης (αν χρειάζεται) + κράτηση + συμβόλαιο. Αν αποτύχει
//        οτιδήποτε, δεν γράφεται τίποτα.
//
// Απαιτεί contracts.create ΚΑΙ bookings.create. Ο συνεργάτης κλειδώνεται
// στον εαυτό του (resolvePartnerId). Ο server υπολογίζει τα πάντα.

import { z } from "zod";
import { db } from "@/lib/db";
import { ok, created, badRequest, conflict, serverError } from "@/lib/api";
import { viewerCan, withPermission } from "@/lib/authz";
import { TIME_RE } from "@/lib/bookings";
import { prepareBooking, writeBooking } from "@/lib/bookingCreate";
import { createContractInTx } from "@/lib/contractForm";
import {
  findDuplicateCustomers,
  loadWalkInVehicles,
  toWalkInPreview,
  walkInSchema,
} from "@/lib/walkIn";

const PERMISSIONS = ["contracts.create", "bookings.create"] as const;

const windowSchema = z.object({
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickupTime: z.string().regex(TIME_RE),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnTime: z.string().regex(TIME_RE),
});

// GET /api/contracts/walk-in?pickupDate=&pickupTime=&returnDate=&returnTime=&all=1
export const GET = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      const sp = new URL(req.url).searchParams;
      const parsed = windowSchema.safeParse(Object.fromEntries(sp));
      if (!parsed.success) return badRequest("Μη έγκυρο διάστημα", parsed.error.errors);

      // Τα μη διαθέσιμα τα βλέπει μόνο όποιος μπορεί να κάνει override.
      const all = sp.get("all") === "1" && viewerCan(viewer!, "bookings.override");
      const vehicles = await loadWalkInVehicles(viewer!.tenantId!, parsed.data, all);
      return ok({ vehicles });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  [...PERMISSIONS]
);

// POST /api/contracts/walk-in
export const POST = withPermission(
  async (req, session, _params, viewer) => {
    try {
      const parsed = walkInSchema.safeParse(await req.json());
      if (!parsed.success) return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      const data = parsed.data;
      const tenantId = viewer!.tenantId!;

      // Ίδιος κώδικας με το POST κράτησης. Walk-in: ο πελάτης είναι
      // παρών, άρα CONFIRMED (το όχημα δεσμεύεται) ανεξάρτητα από rentalMode.
      const prepared = await prepareBooking({
        viewer: viewer!,
        data: { ...data, customerId: data.customerId ?? null },
        forceStatus: "CONFIRMED",
        source: "walk-in",
        preview: data.preview,
      });
      if (!prepared.ok) return prepared.response;

      const { plan, conflicts } = prepared;

      if (data.preview) {
        return ok({ preview: await toWalkInPreview(viewer!, plan, conflicts) });
      }

      // Νέος πελάτης με τηλέφωνο/email που ήδη υπάρχει: προτείνουμε τον
      // υπάρχοντα, εκτός αν ο χρήστης επιμένει ρητά.
      const fresh = data.newCustomer;
      if (fresh && !data.allowDuplicate) {
        const duplicates = await findDuplicateCustomers(tenantId, fresh.phone, fresh.email ?? "");
        if (duplicates.length > 0) {
          return conflict("Υπάρχει ήδη πελάτης με αυτό το τηλέφωνο ή email", {
            duplicates,
          });
        }
      }

      const result = await db.$transaction(
        async (tx) => {
          let customerId = plan.customerId;
          if (!customerId) {
            const customer = await tx.customer.create({
              data: {
                tenantId,
                firstName: fresh!.firstName,
                lastName: fresh!.lastName,
                phone: fresh!.phone,
                email: fresh!.email || null,
              },
              select: { id: true },
            });
            customerId = customer.id;
          }

          const booking = await writeBooking(tx, plan, customerId);
          const contract = await createContractInTx(tx, viewer!, session.name, {
            id: booking.id,
            customerId,
            pickupLocation: booking.pickupLocation,
            returnLocation: booking.returnLocation,
            deposit: booking.deposit,
          });
          return { bookingId: booking.id, contractId: contract.id };
        },
        { maxWait: 10000, timeout: 20000 }
      );

      return created({ id: result.contractId, bookingId: result.bookingId });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  [...PERMISSIONS]
);
