export const dynamic = "force-dynamic";
// src/app/api/contracts/walk-in/customers/route.ts
// Αναγνώριση παλιού πελάτη στο νέο συμβόλαιο. Tenant-scoped, με τα ΙΔΙΑ
// δικαιώματα με το walk-in (contracts.create ΚΑΙ bookings.create).
//
//  ?field=name|phone|email|idNumber|licenseNumber|address&q=
//      → έως 8 πελάτες: ΜΟΝΟ όνομα, τηλέφωνο, πλήθος κρατήσεων.
//  ?phone=&email=   → πιθανοί διπλότυποι νέου πελάτη (ίδια μορφή).
//  ?id=             → τα στοιχεία ενός πελάτη για τον κύριο οδηγό, αφού
//                     τον διάλεξε ο χρήστης.

import { ok, badRequest, notFound, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { isCustomerSearchField } from "@/lib/customerMatch";
import { customerAsDriver, findDuplicateCustomers, searchWalkInCustomers } from "@/lib/walkIn";

export const GET = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      const sp = new URL(req.url).searchParams;
      const tenantId = viewer!.tenantId!;

      const id = sp.get("id");
      if (id !== null) {
        const driver = await customerAsDriver(tenantId, id.slice(0, 40));
        if (!driver) return notFound("Ο πελάτης δεν βρέθηκε");
        return ok({ driver });
      }

      const q = sp.get("q");
      if (q !== null) {
        const field = sp.get("field") ?? "name";
        if (!isCustomerSearchField(field)) return badRequest("Μη έγκυρο πεδίο");
        return ok({ customers: await searchWalkInCustomers(tenantId, field, q.slice(0, 100)) });
      }

      const phone = sp.get("phone")?.slice(0, 40) ?? "";
      const email = sp.get("email")?.slice(0, 200) ?? "";
      return ok({ customers: await findDuplicateCustomers(tenantId, phone, email) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["contracts.create", "bookings.create"]
);
