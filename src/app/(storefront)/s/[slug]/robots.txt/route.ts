// /s/<slug>/robots.txt — της εταιρίας (θα χρησιμεύσει ως /robots.txt όταν
// αποκτήσει δικό της domain). Ανενεργή σελίδα ή άγνωστο slug → 404.
import { storefrontRobots } from "@/lib/storefront/seoRoutes";

export const dynamic = "force-dynamic";

export function GET(_req: Request, { params }: { params: { slug: string } }) {
  return storefrontRobots(params.slug);
}
