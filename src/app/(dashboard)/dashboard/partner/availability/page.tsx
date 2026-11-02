// /dashboard/partner/availability — διαθεσιμότητα (και κράτηση, με το δικαίωμα) για τον συνεργάτη.
import { redirect } from "next/navigation";
import { isPartner, pageGuard, viewerCan } from "@/lib/authz";
import { loadPartnerAvailability } from "@/lib/partnerServer";
import { tenantNowLocal } from "@/lib/bookingConflicts";
import { db } from "@/lib/db";
import PartnerAvailabilityClient from "./PartnerAvailabilityClient";

export const dynamic = "force-dynamic";

const DAYS = 14;

export default async function PartnerAvailabilityPage() {
  const guard = await pageGuard("partner.availability");
  if (!guard || !isPartner(guard.viewer)) redirect("/dashboard");
  const viewer = { ...guard.viewer, tenantId: guard.session.tenantId };
  const today = (await tenantNowLocal(db, viewer.tenantId)).slice(0, 10);
  const initial = await loadPartnerAvailability(viewer, today, DAYS);
  return (
    <PartnerAvailabilityClient
      today={today}
      days={DAYS}
      initial={initial ?? { days: [], vehicles: [] }}
      canBook={viewerCan(guard.viewer, "partner.book")}
    />
  );
}
