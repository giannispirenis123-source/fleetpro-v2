import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { toExtraDTO } from "@/lib/extras";
import ExtrasClient from "./ExtrasClient";

export const dynamic = "force-dynamic";

export default async function ExtrasPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "SUPER_ADMIN") redirect("/super-admin");
  if (!session.tenantId) redirect("/login");

  // Εδώ φέρνουμε και τα ανενεργά: ο διαχειριστής πρέπει να μπορεί να τα
  // ξαναενεργοποιήσει από το φίλτρο.
  const extras = await db.extra.findMany({
    where: { tenantId: session.tenantId },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  return (
    <ExtrasClient
      initialExtras={extras.map(toExtraDTO)}
      role={session.role}
    />
  );
}
