import { redirect } from "next/navigation";
import { pageGuard, viewerCan } from "@/lib/authz";
import { discountScope } from "@/lib/discountAccess";
import { db } from "@/lib/db";
import { toDiscountDTO } from "@/lib/discountMapper";
import DiscountsClient from "./DiscountsClient";

export const dynamic = "force-dynamic";

export default async function DiscountsPage() {
  // Ο φύλακας διαβάζει το ΙΔΙΟ κλειδί με το API: καμία σελίδα δεν δείχνει
  // κάτι που ο server θα αρνιόταν.
  const guard = await pageGuard("discounts.view");
  if (!guard) redirect("/dashboard");
  const { session, viewer } = guard;

  const tenantId = session.tenantId;
  // Συνεργάτης: ΜΟΝΟ όσοι κωδικοί του ανατέθηκαν, μόνο ανάγνωση, χωρίς λίστα
  // πελατών ή άλλων συνεργατών της εταιρίας.
  const isPartner = viewer.role === "PARTNER";

  // Φέρνουμε και τους ανενεργούς: ο διαχειριστής πρέπει να μπορεί να τους
  // ξαναενεργοποιήσει από το φίλτρο.
  const [discounts, customers, partners] = await Promise.all([
    db.discount.findMany({
      where: discountScope(viewer),
      orderBy: { createdAt: "desc" },
    }),
    isPartner
      ? Promise.resolve([])
      : db.customer.findMany({
          where: { tenantId },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          select: { id: true, firstName: true, lastName: true },
        }),
    // Οι συνεργάτες της ΙΔΙΑΣ εταιρίας (για τη λίστα της φόρμας και την κάρτα)·
    // ο συνεργάτης βλέπει μόνο τον εαυτό του.
    db.user.findMany({
      where: { tenantId: tenantId!, role: "PARTNER", ...(isPartner ? { id: viewer.userId } : {}) },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isActive: true, commissionRate: true },
    }),
  ]);

  // Το targetValue κρατά id πελάτη· το μετατρέπουμε σε όνομα για εμφάνιση.
  const nameById = new Map(
    customers.map((c) => [c.id, `${c.firstName} ${c.lastName}`])
  );

  return (
    <DiscountsClient
      initialDiscounts={discounts.map((d) =>
        toDiscountDTO(
          d,
          d.target === "CUSTOMER" && d.targetValue
            ? nameById.get(d.targetValue) ?? null
            : null
        )
      )}
      customers={customers.map((c) => ({
        id: c.id,
        label: `${c.firstName} ${c.lastName}`,
      }))}
      partners={partners.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive, rate: Number(p.commissionRate) }))}
      can={{
        create: viewerCan(viewer, "discounts.create"),
        edit: viewerCan(viewer, "discounts.edit"),
        delete: viewerCan(viewer, "discounts.delete"),
      }}
    />
  );
}
