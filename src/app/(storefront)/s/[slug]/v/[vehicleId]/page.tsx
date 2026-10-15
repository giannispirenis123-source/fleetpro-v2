// /s/<slug>/v/<id> → /s/<slug>/<προεπιλεγμένη γλώσσα>/v/<id> — βλ. src/lib/storefront/page.ts.
import { redirectToDefaultLanguage } from "@/lib/storefront/page";

export const dynamic = "force-dynamic";

export default async function StorefrontVehicleRoot({ params }: { params: { slug: string; vehicleId: string } }) {
  return redirectToDefaultLanguage(params.slug, params.vehicleId);
}
