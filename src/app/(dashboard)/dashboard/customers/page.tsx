import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { toCustomerDTO } from "@/lib/customers";
import CustomersClient from "./CustomersClient";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "SUPER_ADMIN") redirect("/super-admin");
  if (!session.tenantId) redirect("/login");

  // Ο συνεργάτης δεν έχει πρόσβαση στις καρτέλες πελατών.
  if (session.role === "PARTNER") redirect("/dashboard");

  // Αρχική λίστα από τη βάση: η σελίδα έρχεται ήδη γεμάτη, χωρίς loading state.
  const customers = await db.customer.findMany({
    where: { tenantId: session.tenantId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { _count: { select: { bookings: true } } },
  });

  return <CustomersClient initialCustomers={customers.map(toCustomerDTO)} />;
}
