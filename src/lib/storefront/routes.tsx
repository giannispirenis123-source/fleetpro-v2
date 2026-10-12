// src/lib/storefront/routes.tsx
// Οι 4 διαδρομές του site (/s/<slug>, /s/<slug>/<lang>, και /v/<id> στο
// καθένα) μοιράζονται αυτές τις δύο σελίδες — τα αρχεία page.tsx απλώς
// τις καλούν με τις παραμέτρους τους. ΜΟΝΟ server.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { openStorefront } from "./page";
import { loadPublicVehicle, loadPublicVehicles } from "./resolve";
import { pickText } from "./settings";
import { StorefrontHome, StorefrontVehicle } from "@/components/storefront/StorefrontViews";

export interface StorefrontParams {
  slug: string;
  lang?: string;
  vehicleId?: string;
}

export async function storefrontHomeMetadata(p: StorefrontParams): Promise<Metadata> {
  const { company, lang } = await openStorefront(p.slug, p.lang);
  const s = company.settings;
  const title = pickText(s.title, lang, s.defaultLanguage) || company.name;
  return {
    title: title === company.name ? title : `${title} — ${company.name}`,
    description: pickText(s.tagline, lang, s.defaultLanguage) || undefined,
  };
}

export async function StorefrontHomePage({ params }: { params: StorefrontParams }) {
  const { company, companyId, lang } = await openStorefront(params.slug, params.lang);
  const vehicles = await loadPublicVehicles(companyId);
  return <StorefrontHome company={company} vehicles={vehicles} lang={lang} />;
}

export async function storefrontVehicleMetadata(p: StorefrontParams): Promise<Metadata> {
  const { company, companyId } = await openStorefront(p.slug, p.lang, p.vehicleId);
  const vehicle = p.vehicleId ? await loadPublicVehicle(companyId, p.vehicleId) : null;
  return { title: vehicle ? `${vehicle.brand} ${vehicle.model} — ${company.name}` : company.name };
}

export async function StorefrontVehiclePage({ params }: { params: StorefrontParams }) {
  const { company, companyId, lang } = await openStorefront(params.slug, params.lang, params.vehicleId);
  const vehicle = params.vehicleId ? await loadPublicVehicle(companyId, params.vehicleId) : null;
  if (!vehicle) notFound();
  return <StorefrontVehicle company={company} vehicle={vehicle} lang={lang} />;
}
