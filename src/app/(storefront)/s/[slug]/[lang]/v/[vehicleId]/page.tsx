// Σελίδα οχήματος στο δημόσιο site — βλ. src/lib/storefront/routes.tsx.
import { StorefrontVehiclePage, storefrontVehicleMetadata, type StorefrontParams } from "@/lib/storefront/routes";

export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: StorefrontParams }) =>
  storefrontVehicleMetadata(params);

export default StorefrontVehiclePage;
