export const dynamic = "force-dynamic";
// src/app/api/contracts/bookings/route.ts
// Κρατήσεις ΧΩΡΙΣ συμβόλαιο (όχι ακυρωμένες) για το «+ Νέο συμβόλαιο».
// Στεγανότητα συνεργάτη μέσω bookingScope.

import { ok, serverError } from "@/lib/api";
import { withPermission } from "@/lib/authz";
import { loadBookingsWithoutContract } from "@/lib/contractForm";

// GET /api/contracts/bookings?q=
export const GET = withPermission(
  async (req, _session, _params, viewer) => {
    try {
      const q = new URL(req.url).searchParams.get("q")?.slice(0, 100) ?? null;
      return ok({ bookings: await loadBookingsWithoutContract(viewer!, q) });
    } catch (error) {
      console.error(error);
      return serverError();
    }
  },
  ["contracts.view", "contracts.create"]
);
