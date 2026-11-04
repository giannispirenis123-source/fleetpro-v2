// /dashboard/partner/availability — διαθεσιμότητα (και κράτηση, με το δικαίωμα) για τον συνεργάτη.
import { redirect } from "next/navigation";
import { isPartner, pageGuard, viewerCan } from "@/lib/authz";
import { loadPartnerAvailability } from "@/lib/partnerServer";
import { tenantNowLocal } from "@/lib/bookingConflicts";
import { db } from "@/lib/db";
import { toExtraDTO } from "@/lib/extras";
import PartnerAvailabilityClient from "./PartnerAvailabilityClient";

export const dynamic = "force-dynamic";

const DAYS = 14;

export default async function PartnerAvailabilityPage() {
  const guard = await pageGuard("partner.availability");
  if (!guard || !isPartner(guard.viewer)) redirect("/dashboard");
  const viewer = { ...guard.viewer, tenantId: guard.session.tenantId };
  const today = (await tenantNowLocal(db, viewer.tenantId)).slice(0, 10);
  const canBook = viewerCan(guard.viewer, "partner.book");
  const [initial, extras] = await Promise.all([
    loadPartnerAvailability(viewer, today, DAYS),
    // Ίδια με τη φόρμα του προσωπικού: μόνο τα ενεργά πρόσθετα/ασφάλειες.
    canBook
      ? db.extra.findMany({ where: { tenantId: viewer.tenantId, isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }] })
      : Promise.resolve([]),
  ]);
  return (
    <PartnerAvailabilityClient
      today={today}
      days={DAYS}
      initial={initial ?? { days: [], vehicles: [] }}
      canBook={canBook}
      extras={extras.map((e) => {
        const d = toExtraDTO(e);
        return { id: d.id, name: d.name, type: d.type, price: d.price, chargeType: d.chargeType };
      })}
    />
  );
}
