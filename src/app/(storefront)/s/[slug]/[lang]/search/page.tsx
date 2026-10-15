// /s/<slug>/<lang>/search — βλ. src/lib/storefront/routes.tsx.
import { StorefrontSearchPage, storefrontSearchMetadata, type StorefrontParams } from "@/lib/storefront/routes";

export const dynamic = "force-dynamic";

type Props = { params: StorefrontParams; searchParams: Record<string, string | string[] | undefined> };

export const generateMetadata = ({ params, searchParams }: Props) => storefrontSearchMetadata(params, searchParams);

export default function Page(props: Props) {
  return StorefrontSearchPage(props);
}
