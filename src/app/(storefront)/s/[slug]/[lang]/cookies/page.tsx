// /s/<slug>/<lang>/cookies — νομικό κείμενο της εταιρίας (βλ. src/lib/storefront/routes.tsx).
import { StorefrontLegalPage, storefrontLegalMetadata, type StorefrontParams } from "@/lib/storefront/routes";

export const dynamic = "force-dynamic";

type Props = { params: StorefrontParams };

export const generateMetadata = ({ params }: Props) => storefrontLegalMetadata(params, "cookies");

export default function Page({ params }: Props) {
  return StorefrontLegalPage({ params, kind: "cookies" });
}
