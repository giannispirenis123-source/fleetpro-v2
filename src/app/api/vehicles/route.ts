export const dynamic = "force-dynamic";
// src/app/api/vehicles/route.ts
// Στόλος οχημάτων ανά tenant

import { z } from "zod";
import { db } from "@/lib/db";
import {
  ok,
  created,
  badRequest,
  serverError,
} from "@/lib/api";
import { withPermission } from "@/lib/authz";
import {
  FUEL_TYPES,
  VEHICLE_CATEGORIES,
  VEHICLE_STATUSES,
  toVehicleDTO,
} from "@/lib/vehicles";

// "YYYY-MM-DD", κενό ή null — το UI στέλνει κενό όταν δεν έχει συμπληρωθεί.
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

const createVehicleSchema = z.object({
  // Υποχρεωτικά (NOT NULL χωρίς default στο schema)
  brand: z.string().min(1, "Απαιτείται μάρκα"),
  model: z.string().min(1, "Απαιτείται μοντέλο"),
  plate: z.string().min(2, "Απαιτείται πινακίδα"),
  year: z.number().int().min(1900).max(2100),
  dailyRate: z.number().positive("Θετική τιμή"),

  // Προαιρετικά — έχουν default στη βάση
  color: nullableText,
  category: z.enum(VEHICLE_CATEGORIES).default("B"),
  status: z.enum(VEHICLE_STATUSES).default("AVAILABLE"),
  fuel: z.enum(FUEL_TYPES).default("PETROL"),
  km: z.number().int().min(0).default(0),
  seats: z.number().int().min(1).max(60).default(5),
  doors: z.number().int().min(1).max(10).default(4),
  transmission: z.string().min(1).default("Manual"),
  ac: z.boolean().default(true),
  nextServiceKm: z.union([z.number().int().min(0), z.null()]).optional(),
  nextServiceDate: dateField,
  insuranceExpiry: dateField,
  kteoExpiry: dateField,
  notes: nullableText,
});

// GET /api/vehicles — λίστα οχημάτων του tenant
export const GET = withPermission(
  async (req, session) => {
    try {
      const url = new URL(req.url);
      const includeInactive =
        url.searchParams.get("includeInactive") === "true";

      const vehicles = await db.vehicle.findMany({
        where: {
          tenantId: session.tenantId!,
          ...(includeInactive ? {} : { isActive: true }),
        },
        orderBy: [{ brand: "asc" }, { model: "asc" }],
      });

      return ok(vehicles.map(toVehicleDTO));
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "fleet.view"
);

// POST /api/vehicles — δημιουργία οχήματος
export const POST = withPermission(
  async (req, session) => {
    try {
      const body = await req.json();
      const parsed = createVehicleSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;
      const plate = data.plate.trim().toUpperCase();

      // Η πινακίδα είναι μοναδική ανά εταιρία (@@unique([tenantId, plate]))
      const existing = await db.vehicle.findFirst({
        where: { tenantId: session.tenantId!, plate },
      });
      if (existing) {
        return badRequest("Υπάρχει ήδη όχημα με αυτή την πινακίδα");
      }

      const vehicle = await db.vehicle.create({
        data: {
          tenantId: session.tenantId!,
          brand: data.brand.trim(),
          model: data.model.trim(),
          plate,
          year: data.year,
          dailyRate: data.dailyRate,
          color: data.color || null,
          category: data.category,
          status: data.status,
          fuel: data.fuel,
          km: data.km,
          seats: data.seats,
          doors: data.doors,
          transmission: data.transmission,
          ac: data.ac,
          nextServiceKm: data.nextServiceKm ?? null,
          nextServiceDate: toDate(data.nextServiceDate),
          insuranceExpiry: toDate(data.insuranceExpiry),
          kteoExpiry: toDate(data.kteoExpiry),
          notes: data.notes || null,
        },
      });

      return created({ vehicle: toVehicleDTO(vehicle) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "fleet.create"
);
