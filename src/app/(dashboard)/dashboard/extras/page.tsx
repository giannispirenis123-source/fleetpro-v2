import { redirect } from "next/navigation";
import { pageGuard } from "@/lib/authz";
import { db } from "@/lib/db";
import { toExtraDTO } from "@/lib/extras";
import ExtrasClient from "./ExtrasClient";

export const dynamic = "force-dynamic";

export default async function ExtrasPage() {
  // Ο φύλακας διαβάζει το ΙΔΙΟ κλειδί με το API: καμία σελίδα δεν δείχνει
  // κάτι που ο server θα αρνιόταν.
  const guard = await pageGuard("extras.view");
  if (!guard) redirect("/dashboard");
  const { session } = guard;

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
