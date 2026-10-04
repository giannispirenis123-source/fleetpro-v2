export const dynamic = "force-dynamic";
// src/app/api/contracts/walk-in/customers/route.ts
// Πελάτες για το γρήγορο συμβόλαιο: αναζήτηση (?q=) ή πιθανοί διπλότυποι
// νέου πελάτη (?phone=&email=). Tenant-scoped· έως 10 αποτελέσματα.

import { ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { findDuplicateCustomers, searchWalkInCustomers } from "@/lib/walkIn";

// GET /api/contracts/walk-in/customers?q=  |  ?phone=&email=
export const GET = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      const sp = new URL(req.url).searchParams;
      const tenantId = viewer!.tenantId!;
      const q = sp.get("q")?.slice(0, 100);

      if (q !== undefined) {
        return ok({ customers: await searchWalkInCustomers(tenantId, q) });
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
