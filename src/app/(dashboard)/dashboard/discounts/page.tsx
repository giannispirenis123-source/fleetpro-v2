import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { toDiscountDTO } from "@/lib/discountMapper";
import DiscountsClient from "./DiscountsClient";

export const dynamic = "force-dynamic";

export default async function DiscountsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "SUPER_ADMIN") redirect("/super-admin");
  if (!session.tenantId) redirect("/login");

  // Οι εκπτώσεις είναι εμπορική απόφαση — μόνο ο διαχειριστής.
  if (session.role !== "COMPANY_ADMIN") redirect("/dashboard");

  const tenantId = session.tenantId;

  // Φέρνουμε και τους ανενεργούς: ο διαχειριστής πρέπει να μπορεί να τους
  // ξαναενεργοποιήσει από το φίλτρο.
  const [discounts, customers] = await Promise.all([
    db.discount.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    }),
    db.customer.findMany({
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
    />
  );
}
