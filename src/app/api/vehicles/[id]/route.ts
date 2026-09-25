export const dynamic = "force-dynamic";
// src/app/api/vehicles/[id]/route.ts
// Επεξεργασία και (ήπια) διαγραφή οχήματος.
//
// Κάθε ερώτημα φιλτράρει ΚΑΙ με tenantId από το session: το id μόνο του δεν αρκεί,
// αλλιώς μια εταιρία θα μπορούσε να πειράξει όχημα άλλης μαντεύοντας id.

import { z } from "zod";
import { db } from "@/lib/db";
import {
  ok,
  badRequest,
  notFound,
  serverError,
  forbidden,
} from "@/lib/api";
import { withPermission, sessionCan } from "@/lib/authz";
import {
  FUEL_TYPES,
  VEHICLE_CATEGORIES,
  VEHICLE_STATUSES,
  toVehicleDTO,
} from "@/lib/vehicles";

const dateField = z
  .union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Μορφή ημερομηνίας: YYYY-MM-DD"),
    z.literal(""),
    z.null(),
  ])
  .optional();

const toDate = (value?: string | null): Date | null =>
  value ? new Date(`${value}T00:00:00.000Z`) : null;

const nullableText = z.union([z.string(), z.null()]).optional();

const updateVehicleSchema = z.object({
  brand: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  plate: z.string().min(2).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  dailyRate: z.number().positive().optional(),
  color: nullableText,
  category: z.enum(VEHICLE_CATEGORIES).optional(),
  status: z.enum(VEHICLE_STATUSES).optional(),
  fuel: z.enum(FUEL_TYPES).optional(),
  km: z.number().int().min(0).optional(),
  seats: z.number().int().min(1).max(60).optional(),
  doors: z.number().int().min(1).max(10).optional(),
  transmission: z.string().min(1).optional(),
  ac: z.boolean().optional(),
  nextServiceKm: z.union([z.number().int().min(0), z.null()]).optional(),
  nextServiceDate: dateField,
  insuranceExpiry: dateField,
  kteoExpiry: dateField,
  notes: nullableText,
});

// PATCH /api/vehicles/[id]
export const PATCH = withPermission(
  async (req, session, params) => {
    try {
      const current = await db.vehicle.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
      });
      if (!current) return notFound("Το όχημα δεν βρέθηκε");

      const body = await req.json();
      const parsed = updateVehicleSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;

      // Η αλλαγή κατάστασης οχήματος (διαθέσιμο / συντήρηση / ανενεργό)
      // είναι ξεχωριστό δικαίωμα από την επεξεργασία των στοιχείων του.
      if (data.status !== undefined && data.status !== current.status) {
        if (!(await sessionCan(session, "fleet.status"))) {
          return forbidden("Δεν έχετε δικαίωμα αλλαγής κατάστασης οχήματος");
        }
      }

      const plate = data.plate ? data.plate.trim().toUpperCase() : undefined;

      if (plate && plate !== current.plate) {
        const clash = await db.vehicle.findFirst({
          where: {
            tenantId: session.tenantId!,
            plate,
            NOT: { id: current.id },
          },
        });
        if (clash) {
          return badRequest("Υπάρχει ήδη όχημα με αυτή την πινακίδα");
        }
      }

      const vehicle = await db.vehicle.update({
        where: { id: current.id },
        data: {
          ...(data.brand !== undefined && { brand: data.brand.trim() }),
          ...(data.model !== undefined && { model: data.model.trim() }),
          ...(plate !== undefined && { plate }),
          ...(data.year !== undefined && { year: data.year }),
          ...(data.dailyRate !== undefined && { dailyRate: data.dailyRate }),
          ...(data.color !== undefined && { color: data.color || null }),
          ...(data.category !== undefined && { category: data.category }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.fuel !== undefined && { fuel: data.fuel }),
          ...(data.km !== undefined && { km: data.km }),
          ...(data.seats !== undefined && { seats: data.seats }),
          ...(data.doors !== undefined && { doors: data.doors }),
          ...(data.transmission !== undefined && {
            transmission: data.transmission,
          }),
          ...(data.ac !== undefined && { ac: data.ac }),
          ...(data.nextServiceKm !== undefined && {
            nextServiceKm: data.nextServiceKm,
          }),
          ...(data.nextServiceDate !== undefined && {
            nextServiceDate: toDate(data.nextServiceDate),
          }),
          ...(data.insuranceExpiry !== undefined && {
            insuranceExpiry: toDate(data.insuranceExpiry),
          }),
          ...(data.kteoExpiry !== undefined && {
            kteoExpiry: toDate(data.kteoExpiry),
          }),
          ...(data.notes !== undefined && { notes: data.notes || null }),
        },
      });

      return ok({ vehicle: toVehicleDTO(vehicle) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "fleet.edit"
);

// DELETE /api/vehicles/[id] — ήπια διαγραφή.
// Το όχημα μένει στη βάση ώστε να μη σπάσουν κρατήσεις, συμβόλαια και τιμολόγια
// που το αναφέρουν· απλώς βγαίνει από τον ενεργό στόλο.
export const DELETE = withPermission(
  async (_req, session, params) => {
    try {
      const current = await db.vehicle.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
      });
      if (!current) return notFound("Το όχημα δεν βρέθηκε");

      const vehicle = await db.vehicle.update({
        where: { id: current.id },
        data: { isActive: false, status: "INACTIVE" },
      });

      return ok({ vehicle: toVehicleDTO(vehicle) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "fleet.delete"
);
