export const dynamic = "force-dynamic";
// src/app/api/customers/route.ts
// Πελάτες ανά tenant

import { z } from "zod";
import { db } from "@/lib/db";
import {
  ok,
  created,
  badRequest,
  serverError,
} from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { toCustomerDTO } from "@/lib/customers";

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

// Υποχρεωτικά μόνο το ονοματεπώνυμο: η καρτέλα πρέπει να μπορεί να ανοίξει
// με ό,τι στοιχεία υπάρχουν τη στιγμή της πρώτης επαφής.
const createCustomerSchema = z.object({
  firstName: z.string().min(1, "Απαιτείται όνομα"),
  lastName: z.string().min(1, "Απαιτείται επώνυμο"),

  email: nullableText,
  phone: nullableText,
  phone2: nullableText,
  idNumber: nullableText,
  licenseNumber: nullableText,
  licenseExpiry: dateField,
  licenseCountry: nullableText,
  dateOfBirth: dateField,
  address: nullableText,
  city: nullableText,
  country: nullableText,
  nationality: nullableText,
  notes: nullableText,
  tags: z.array(z.string()).optional(),
  isBlacklisted: z.boolean().optional(),
});

// GET /api/customers — λίστα πελατών του tenant
export const GET = withPermission(
  async (req, session) => {
    try {
      const url = new URL(req.url);
      const q = (url.searchParams.get("q") || "").trim();

      const customers = await db.customer.findMany({
        where: {
          tenantId: session.tenantId!,
          ...(q
            ? {
                OR: [
                  { firstName: { contains: q, mode: "insensitive" as const } },
                  { lastName: { contains: q, mode: "insensitive" as const } },
                  { email: { contains: q, mode: "insensitive" as const } },
                  { phone: { contains: q } },
                ],
              }
            : {}),
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: { _count: { select: { bookings: true } } },
      });

      return ok(customers.map(toCustomerDTO));
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "customers.view"
);

// POST /api/customers — δημιουργία πελάτη
export const POST = withPermission(
  async (req, session) => {
    try {
      const body = await req.json();
      const parsed = createCustomerSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;

      const customer = await db.customer.create({
        data: {
          tenantId: session.tenantId!,
          firstName: data.firstName.trim(),
          lastName: data.lastName.trim(),
          email: data.email?.trim() || null,
          phone: data.phone?.trim() || null,
          phone2: data.phone2?.trim() || null,
          idNumber: data.idNumber?.trim() || null,
          licenseNumber: data.licenseNumber?.trim() || null,
          licenseExpiry: toDate(data.licenseExpiry),
          licenseCountry: data.licenseCountry?.trim() || null,
          dateOfBirth: toDate(data.dateOfBirth),
          address: data.address?.trim() || null,
          city: data.city?.trim() || null,
          country: data.country?.trim() || null,
          nationality: data.nationality?.trim() || null,
          notes: data.notes?.trim() || null,
          tags: data.tags ?? [],
          isBlacklisted: data.isBlacklisted ?? false,
        },
        include: { _count: { select: { bookings: true } } },
      });

      return created({ customer: toCustomerDTO(customer) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  "customers.create"
);
