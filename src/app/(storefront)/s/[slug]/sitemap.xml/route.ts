// /s/<slug>/sitemap.xml — ΜΟΝΟ οι ενεργές, δημόσιες σελίδες της εταιρίας
// (αρχική, μέρη, νομικά) σε κάθε γλώσσα της. Ποτέ search/book/booking/c/pay.
// Ανενεργή σελίδα ή άγνωστο slug → το ίδιο 404, χωρίς στοιχεία.
import { storefrontSitemap } from "@/lib/storefront/seoRoutes";

export const dynamic = "force-dynamic";

export function GET(_req: Request, { params }: { params: { slug: string } }) {
  return storefrontSitemap(params.slug);
}
