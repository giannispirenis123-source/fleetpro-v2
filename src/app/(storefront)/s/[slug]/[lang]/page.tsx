// Αρχική του δημόσιου site /s/<slug>/<lang> — βλ. src/lib/storefront/routes.tsx.
import { StorefrontHomePage, storefrontHomeMetadata, type StorefrontParams } from "@/lib/storefront/routes";

export const dynamic = "force-dynamic";

type Props = { params: StorefrontParams; searchParams: Record<string, string | string[] | undefined> };

export const generateMetadata = ({ params, searchParams }: Props) => storefrontHomeMetadata(params, searchParams);

export default function Page(props: Props) {
  return StorefrontHomePage(props);
}
