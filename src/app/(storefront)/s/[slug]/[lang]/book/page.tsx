// /s/<slug>/<lang>/book — βλ. src/lib/storefront/routes.tsx.
import { StorefrontBookPage, storefrontBookMetadata, type StorefrontParams } from "@/lib/storefront/routes";

export const dynamic = "force-dynamic";

type Props = { params: StorefrontParams; searchParams: Record<string, string | string[] | undefined> };

export const generateMetadata = ({ params }: Props) => storefrontBookMetadata(params);

export default function Page(props: Props) {
  return StorefrontBookPage(props);
}
