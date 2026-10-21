// /s/<slug>/<lang>/terms — νομικό κείμενο της εταιρίας (βλ. src/lib/storefront/routes.tsx).
import { StorefrontLegalPage, storefrontLegalMetadata, type StorefrontParams } from "@/lib/storefront/routes";

export const dynamic = "force-dynamic";

type Props = { params: StorefrontParams };

export const generateMetadata = ({ params }: Props) => storefrontLegalMetadata(params, "terms");

export default function Page({ params }: Props) {
  return StorefrontLegalPage({ params, kind: "terms" });
}
