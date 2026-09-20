export const dynamic = "force-dynamic";
// src/app/api/customers/[id]/route.ts
// Επεξεργασία και διαγραφή πελάτη.
//
// Κάθε ερώτημα φιλτράρει ΚΑΙ με tenantId από το session: το id μόνο του δεν αρκεί,
// αλλιώς μια εταιρία θα μπορούσε να δει ή να πειράξει πελάτη άλλης.

import { z } from "zod";
import { db } from "@/lib/db";
import {
  withAuth,
  ok,
  badRequest,
  notFound,
  serverError,
} from "@/lib/api";
import { toCustomerDTO } from "@/lib/customers";

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

const updateCustomerSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
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

const text = (v?: string | null) => (v?.trim() ? v.trim() : null);

// PATCH /api/customers/[id]
export const PATCH = withAuth(
  async (req, session, params) => {
    try {
      const current = await db.customer.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
      });
      if (!current) return notFound("Ο πελάτης δεν βρέθηκε");

      const body = await req.json();
      const parsed = updateCustomerSchema.safeParse(body);

      if (!parsed.success) {
        return badRequest("Μη έγκυρα δεδομένα", parsed.error.errors);
      }

      const data = parsed.data;

      const customer = await db.customer.update({
        where: { id: current.id },
        data: {
          ...(data.firstName !== undefined && {
            firstName: data.firstName.trim(),
          }),
          ...(data.lastName !== undefined && {
            lastName: data.lastName.trim(),
          }),
          ...(data.email !== undefined && { email: text(data.email) }),
          ...(data.phone !== undefined && { phone: text(data.phone) }),
          ...(data.phone2 !== undefined && { phone2: text(data.phone2) }),
          ...(data.idNumber !== undefined && { idNumber: text(data.idNumber) }),
          ...(data.licenseNumber !== undefined && {
            licenseNumber: text(data.licenseNumber),
          }),
          ...(data.licenseExpiry !== undefined && {
            licenseExpiry: toDate(data.licenseExpiry),
          }),
          ...(data.licenseCountry !== undefined && {
            licenseCountry: text(data.licenseCountry),
          }),
          ...(data.dateOfBirth !== undefined && {
            dateOfBirth: toDate(data.dateOfBirth),
          }),
          ...(data.address !== undefined && { address: text(data.address) }),
          ...(data.city !== undefined && { city: text(data.city) }),
          ...(data.country !== undefined && { country: text(data.country) }),
          ...(data.nationality !== undefined && {
            nationality: text(data.nationality),
          }),
          ...(data.notes !== undefined && { notes: text(data.notes) }),
          ...(data.tags !== undefined && { tags: data.tags }),
          ...(data.isBlacklisted !== undefined && {
            isBlacklisted: data.isBlacklisted,
          }),
        },
        include: { _count: { select: { bookings: true } } },
      });

      return ok({ customer: toCustomerDTO(customer) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN", "STAFF"]
);

// DELETE /api/customers/[id] — πραγματική διαγραφή, αλλά μόνο όταν ο πελάτης
// δεν αφήνει τίποτα πίσω του.
//
// Ο Customer δεν έχει πεδίο isActive, οπότε δεν υπάρχει ήπια διαγραφή.
// Ελέγχουμε και τις τρεις σχέσεις (κρατήσεις, τιμολόγια, συμβόλαια): όλες είναι
// υποχρεωτικές από την πλευρά τους, άρα η διαγραφή θα αποτύγχανε στη βάση με
// σφάλμα ξένου κλειδιού. Προτιμούμε καθαρό μήνυμα αντί για 500.
export const DELETE = withAuth(
  async (_req, session, params) => {
    try {
      const current = await db.customer.findFirst({
        where: { id: params!.id, tenantId: session.tenantId! },
        include: {
          _count: {
            select: { bookings: true, invoices: true, contracts: true },
          },
        },
      });
      if (!current) return notFound("Ο πελάτης δεν βρέθηκε");

      const { bookings, invoices, contracts } = current._count;

      if (bookings > 0 || invoices > 0 || contracts > 0) {
        return badRequest(
          "Ο πελάτης έχει κρατήσεις και δεν μπορεί να διαγραφεί",
          { bookings, invoices, contracts }
        );
      }

      await db.customer.delete({ where: { id: current.id } });

      return ok({ id: current.id });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["COMPANY_ADMIN", "STAFF"]
);
