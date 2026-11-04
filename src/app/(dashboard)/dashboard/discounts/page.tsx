import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { discountScope, partnerCommission } from "@/lib/discountAccess";
import { maxPartnerDiscountPercent } from "@/lib/commission";
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
  // Συνεργάτης: μόνο οι δικοί του κωδικοί, χωρίς λίστα πελατών της εταιρίας,
  // και το μέγιστο ποσοστό (= η προμήθειά του) για τη φόρμα.
  const partner = await partnerCommission(viewer);

  // Φέρνουμε και τους ανενεργούς: ο διαχειριστής πρέπει να μπορεί να τους
  // ξαναενεργοποιήσει από το φίλτρο.
  const [discounts, customers] = await Promise.all([
    db.discount.findMany({
      where: discountScope(viewer),
      orderBy: { createdAt: "desc" },
    }),
    partner
      ? Promise.resolve([])
      : db.customer.findMany({
          where: { tenantId },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          select: { id: true, firstName: true, lastName: true },
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
      partnerMaxPercent={partner ? maxPartnerDiscountPercent(partner) : null}
    />
  );
}
