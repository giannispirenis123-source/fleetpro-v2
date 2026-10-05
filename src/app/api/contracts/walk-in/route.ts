export const dynamic = "force-dynamic";
// src/app/api/contracts/walk-in/route.ts
// Γρήγορο συμβόλαιο χωρίς προϋπάρχουσα κράτηση.
//
// GET  → τα διαθέσιμα οχήματα για το διάστημα.
// POST → { preview: true } μόνο τιμή/σύγκρουση· αλλιώς σε ΜΙΑ transaction
//        πελάτης (νέος από τον κύριο οδηγό, ή ο υπάρχων με συμπλήρωση των
//        κενών του) + κράτηση + συμβόλαιο με τα στοιχεία της φόρμας. Αν
//        αποτύχει οτιδήποτε, δεν γράφεται τίποτα. Επιστρέφει το συμβόλαιο
//        (η φόρμα μένει ανοιχτή και συνεχίζει με υπογραφές/φωτογραφίες).
//
// Απαιτεί contracts.create ΚΑΙ bookings.create. Ο συνεργάτης κλειδώνεται
// στον εαυτό του (resolvePartnerId). Ο server υπολογίζει τα πάντα.

import { z } from "zod";
import { db } from "@/lib/db";
import { ok, created, badRequest, conflict, serverError } from "@/lib/api";
import { viewerCan, withPermission } from "@/lib/authz";
import { TIME_RE } from "@/lib/bookings";
import { prepareBooking, writeBooking } from "@/lib/bookingCreate";
import {
  createContractInTx,
  initialContractData,
  loadContract,
  resolveVehicleChanges,
} from "@/lib/contractForm";
import { customerFromDriver, missingCustomerFields } from "@/lib/customerMatch";
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

      // Ο πελάτης βγαίνει από τον κύριο οδηγό (μόνο πεδία του μοντέλου Customer).
      const form = data.contract!;
      const fromDriver = customerFromDriver(form.drivers[0]);

      // Αλλαγές οχήματος: μοντέλο/πινακίδα από τον Στόλο, ποτέ από τον client.
      const changes = await resolveVehicleChanges(tenantId, form.vehicleChanges ?? []);
      if (!changes.ok) return badRequest(changes.message);

      // Νέος πελάτης με τηλέφωνο/email που ήδη υπάρχει: προτείνουμε τον
      // υπάρχοντα, εκτός αν ο χρήστης επιμένει ρητά.
      if (!plan.customerId && !data.allowDuplicate) {
        const duplicates = await findDuplicateCustomers(
          tenantId,
          fromDriver.phone ?? "",
          fromDriver.email ?? ""
        );
        if (duplicates.length > 0) {
          return conflict("Υπάρχει ήδη πελάτης με αυτό το τηλέφωνο ή email", {
            duplicates,
          });
        }
      }

      const result = await db.$transaction(
        async (tx) => {
          let customerId = plan.customerId;
          const dates = (v: string | null) => (v ? new Date(`${v}T00:00:00.000Z`) : null);
          if (!customerId) {
            const customer = await tx.customer.create({
              data: {
                tenantId,
                ...fromDriver,
                licenseExpiry: dates(fromDriver.licenseExpiry),
                dateOfBirth: dates(fromDriver.dateOfBirth),
                licenseCountry: fromDriver.licenseCountry ?? undefined,
              },
              select: { id: true },
            });
            customerId = customer.id;
          } else {
            // Υπάρχων πελάτης: ΜΟΝΟ τα κενά του πεδία, ποτέ αντικατάσταση.
            const existing = await tx.customer.findFirstOrThrow({
              where: { id: customerId, tenantId },
              select: {
                phone: true,
                email: true,
                idNumber: true,
                licenseNumber: true,
                licenseExpiry: true,
                dateOfBirth: true,
                address: true,
              },
            });
            const missing = missingCustomerFields(
              {
                ...existing,
                licenseExpiry: existing.licenseExpiry?.toISOString() ?? null,
                dateOfBirth: existing.dateOfBirth?.toISOString() ?? null,
              },
              fromDriver
            );
            if (Object.keys(missing).length > 0) {
              await tx.customer.update({
                where: { id: customerId },
                data: {
                  ...missing,
                  ...(missing.licenseExpiry && { licenseExpiry: dates(missing.licenseExpiry) }),
                  ...(missing.dateOfBirth && { dateOfBirth: dates(missing.dateOfBirth) }),
                },
                select: { id: true },
              });
            }
          }

          const booking = await writeBooking(tx, plan, customerId);
          const contract = await createContractInTx(
            tx,
            viewer!,
            session.name,
            {
              id: booking.id,
              customerId,
              pickupLocation: booking.pickupLocation,
              returnLocation: booking.returnLocation,
              deposit: booking.deposit,
            },
            initialContractData(form, changes.changes)
          );
          return { bookingId: booking.id, contractId: contract.id };
        },
        { maxWait: 10000, timeout: 20000 }
      );

      const contract = await loadContract(viewer!, result.contractId);
      return created({ id: result.contractId, bookingId: result.bookingId, contract });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  [...PERMISSIONS]
);
