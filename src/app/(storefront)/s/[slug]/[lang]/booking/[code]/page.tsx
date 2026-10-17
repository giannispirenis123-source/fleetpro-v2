// /s/<slug>/<lang>/booking/<code> — επιβεβαίωση κράτησης. Βλ. src/lib/storefront/routes.tsx.
import { StorefrontConfirmationPage, storefrontConfirmationMetadata, type StorefrontParams } from "@/lib/storefront/routes";

export const dynamic = "force-dynamic";

type Props = { params: StorefrontParams & { code: string }; searchParams?: Record<string, string | string[] | undefined> };

export const generateMetadata = ({ params }: Props) => storefrontConfirmationMetadata(params);

export default function Page(props: Props) {
  return StorefrontConfirmationPage(props);
}
