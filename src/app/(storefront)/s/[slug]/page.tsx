// /s/<slug> → /s/<slug>/<προεπιλεγμένη γλώσσα> — βλ. src/lib/storefront/page.ts.
import { redirectToDefaultLanguage } from "@/lib/storefront/page";

export const dynamic = "force-dynamic";

export default async function StorefrontRoot({ params }: { params: { slug: string } }) {
  return redirectToDefaultLanguage(params.slug);
}
