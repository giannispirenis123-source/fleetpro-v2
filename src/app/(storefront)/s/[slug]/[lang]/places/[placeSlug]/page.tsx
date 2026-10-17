// Σελίδα «Μέρος για επίσκεψη» στο δημόσιο site — βλ. src/lib/storefront/routes.tsx.
import { StorefrontPlacePage, storefrontPlaceMetadata, type StorefrontParams } from "@/lib/storefront/routes";

export const dynamic = "force-dynamic";

type Params = StorefrontParams & { placeSlug: string };

export const generateMetadata = ({ params }: { params: Params }) => storefrontPlaceMetadata(params);

export default StorefrontPlacePage;
