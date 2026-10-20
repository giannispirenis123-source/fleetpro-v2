// src/lib/bookingStatusRule.ts
// Ποιος αλλάζει την κατάσταση μιας κράτησης από τη φόρμα (PATCH) — καθαρή
// λογική, ίδιος κανόνας με την επιβεβαίωση/ακύρωση (bookingDecision.canDecide)
// και το DELETE: ο συνεργάτης ΜΟΝΟ βλέπει· η ακύρωση θέλει bookings.cancel.

import { can, type PermissionMap } from "./permissions";

export function canChangeBookingStatus(viewer: { role: string; permissions: PermissionMap }, next: string): boolean {
  if (viewer.role === "PARTNER" || viewer.role === "SUPER_ADMIN") return false;
  if (!can(viewer.role, viewer.permissions, "bookings.status")) return false;
  if (next === "CANCELLED" && !can(viewer.role, viewer.permissions, "bookings.cancel")) return false;
  return true;
}
