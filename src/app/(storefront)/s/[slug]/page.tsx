// Δημόσια σελίδα εταιρίας — βλ. src/lib/storefront/routes.tsx.
import { StorefrontHomePage, storefrontHomeMetadata, type StorefrontParams } from "@/lib/storefront/routes";

export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: StorefrontParams }) =>
  storefrontHomeMetadata(params);

export default StorefrontHomePage;
