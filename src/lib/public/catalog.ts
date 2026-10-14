// src/lib/public/catalog.ts
// Οι κάρτες του δημόσιου site (μία ανά rental_group· όχημα χωρίς ομάδα =
// δική του κάρτα) — ΚΑΘΑΡΗ λογική, χωρίς βάση.
//
// Τι ΒΓΑΙΝΕΙ (whitelist, όπως το publicData.ts): όνομα, «ή παρόμοιο»,
// φωτογραφία, θέσεις/πόρτες/κιβώτιο/καύσιμο/αποσκευές/A/C/cc, τιμή, ΑΡΙΘΜΟΣ
// διαθέσιμων. ΠΟΤΕ πινακίδες, ids οχημάτων ομάδας, εταιρίας, πελάτες,
// κρατήσεις. Το κλειδί της κάρτας είναι ο κωδικός της ομάδας ("g.A") — για
// όχημα χωρίς ομάδα το id του ("v.<id>"), που είναι ήδη δημόσιο (σελίδα οχήματος).
//
// ΤΙΜΗ: δεν υπολογίζεται εδώ. Ο server καλεί quote()/fromPrice()
// (pricing.ts) και περνά ΜΟΝΟ το αποτέλεσμα (cents) στην κάρτα.

import { VEHICLE_TYPES, type VehicleType } from "./pricing";
import { textFor, type LocalizedText } from "./text";

export interface CatalogGroup {
  id: string;
  code: string;
  vehicleType: string;
  name: LocalizedText;
  similarModels: LocalizedText;
  seats: number;
  doors: number | null;
  /** "manual" | "automatic" */
  transmission: string;
  fuel: string;
  bagsLarge: number;
  bagsSmall: number;
  airCondition: boolean;
  engineCc: number | null;
  photoUrl: string | null;
  sortOrder: number;
}

export interface CatalogVehicle {
  id: string;
  tenantId: string;
  rentalGroupId: string | null;
  brand: string;
  model: string;
  vehicleType: string;
  seats: number;
  doors: number;
  /** "Manual" | "Automatic" (παλιά μορφή του Στόλου) */
  transmission: string;
  fuel: string;
  ac: boolean;
  photoUrl: string | null;
  status: string;
  isActive: boolean;
}

export interface CardSpecs {
  seats: number;
  doors: number | null;
  transmission: "manual" | "automatic";
  fuel: string;
  bagsLarge: number;
  bagsSmall: number;
  ac: boolean;
  engineCc: number | null;
}

/** Ό,τι φτάνει στον browser για μια κάρτα. */
export interface PublicCard {
  key: string;
  type: VehicleType;
  name: string;
  /** «Fiat Panda» → «Fiat Panda ή παρόμοιο»· null για μεμονωμένο όχημα. */
  similar: string | null;
  photoUrl: string | null;
  specs: CardSpecs;
  sortOrder: number;
}

export interface CardPrice {
  days: number;
  totalCents: number;
  /** Σύνολο χωρίς έκπτωση — διαγραμμένο όταν > totalCents. */
  listTotalCents: number;
  avgDailyCents: number;
  badge: string | null;
}

export interface CardFromPrice {
  dailyCents: number;
  listDailyCents: number;
  badge: string | null;
}

export interface ResultCard extends PublicCard {
  /** Με αναζήτηση: τιμή για τις ημέρες (null = χωρίς τιμή → μη διαθέσιμο). */
  price: CardPrice | null;
  /** Χωρίς αναζήτηση: «από X €/ημέρα». */
  from: CardFromPrice | null;
  /** Με αναζήτηση: πόσα ελεύθερα (0 = μη διαθέσιμο). null = χωρίς αναζήτηση. */
  available: number | null;
  /** Γιατί δεν κλείνεται (π.χ. ηλικία κάτω από το όριο της ομάδας). */
  note: string | null;
  /** Link κράτησης — μόνο όταν είναι διαθέσιμο. */
  bookHref: string | null;
}

export const asVehicleType = (v: string): VehicleType => ((VEHICLE_TYPES as readonly string[]).includes(v) ? (v as VehicleType) : "car");

export const groupKey = (code: string) => `g.${code}`;
export const vehicleKey = (id: string) => `v.${id}`;

const KEY_RE = /^(g\.[A-Z0-9][A-Z0-9-]{0,19}|v\.[A-Za-z0-9_-]{1,64})$/;
export const isCardKey = (k: unknown): k is string => typeof k === "string" && KEY_RE.test(k);

/** Ορατά οχήματα: ενεργά, όχι «Ανενεργό» (σε service μετρούν ως ύπαρξη, όχι ως διαθέσιμα). */
const listed = (v: CatalogVehicle) => v.isActive && v.status !== "INACTIVE";

/**
 * Κάρτες: ομάδες με τουλάχιστον ένα ορατό όχημα + οχήματα χωρίς ομάδα.
 * `groups` = μόνο ενεργές/δημόσιες ομάδες της εταιρίας. Όχημα σε ομάδα που
 * δεν είναι στη λίστα (ανενεργή/κρυφή) δεν εμφανίζεται πουθενά.
 */
export function buildCards(groups: CatalogGroup[], vehicles: CatalogVehicle[], lang: string): PublicCard[] {
  const cards: PublicCard[] = [];
  for (const g of groups) {
    const members = vehicles.filter((v) => v.rentalGroupId === g.id && listed(v));
    if (members.length === 0) continue;
    const similar = textFor(g.similarModels, lang).trim();
    cards.push({
      key: groupKey(g.code),
      type: asVehicleType(g.vehicleType),
      name: textFor(g.name, lang) || g.code,
      similar: similar || null,
      photoUrl: g.photoUrl ?? members.find((v) => v.photoUrl)?.photoUrl ?? null,
      specs: {
        seats: g.seats,
        doors: g.doors,
        transmission: g.transmission === "automatic" ? "automatic" : "manual",
        fuel: g.fuel,
        bagsLarge: g.bagsLarge,
        bagsSmall: g.bagsSmall,
        ac: g.airCondition,
        engineCc: g.engineCc,
      },
      sortOrder: g.sortOrder,
    });
  }
  for (const v of vehicles) {
    if (v.rentalGroupId || !listed(v)) continue;
    cards.push({
      key: vehicleKey(v.id),
      type: asVehicleType(v.vehicleType),
      name: `${v.brand} ${v.model}`.trim(),
      similar: null,
      photoUrl: v.photoUrl,
      specs: {
        seats: v.seats,
        doors: v.doors,
        transmission: v.transmission.toLowerCase() === "automatic" ? "automatic" : "manual",
        fuel: v.fuel,
        bagsLarge: 0,
        bagsSmall: 0,
        ac: v.ac,
        engineCc: null,
      },
      sortOrder: 10_000,
    });
  }
  return cards;
}

/** Σε ποια κάρτα μετρά κάθε όχημα (για τη διαθεσιμότητα). */
export function vehicleCardKey(v: CatalogVehicle, groups: CatalogGroup[]): string | null {
  if (!v.rentalGroupId) return vehicleKey(v.id);
  const g = groups.find((x) => x.id === v.rentalGroupId);
  return g ? groupKey(g.code) : null;
}

/* ─────────────────────────────────────────────
   Καρτέλες τύπου + ταξινόμηση
   ───────────────────────────────────────────── */

/** Οι καρτέλες που έχουν κάρτες, με τη σειρά car → moto → atv. Ένας τύπος → καμία. */
export function typeTabs(cards: Pick<PublicCard, "type">[]): VehicleType[] {
  const present = VEHICLE_TYPES.filter((t) => cards.some((c) => c.type === t));
  return present.length > 1 ? present : [];
}

/** Φίλτρο τύπου· τύπος χωρίς κάρτες (ή κρυμμένη καρτέλα) = όλες. */
export function filterByType<T extends Pick<PublicCard, "type">>(cards: T[], type: VehicleType | null): T[] {
  if (!type || !typeTabs(cards).includes(type)) return cards;
  return cards.filter((c) => c.type === type);
}

export type SortOrder = "price_asc" | "price_desc";

export const isSortOrder = (v: unknown): v is SortOrder => v === "price_asc" || v === "price_desc";

const isBookable = (c: ResultCard) => (c.available === null ? c.from !== null : c.available > 0 && c.price !== null && !c.note);
const priceOf = (c: ResultCard) => c.price?.totalCents ?? c.from?.dailyCents ?? null;

/**
 * Διαθέσιμες πρώτα (φθηνότερη πρώτα ή «Τιμή ↓»), μετά οι μη διαθέσιμες —
 * σταθερά, με τη σειρά της ομάδας σε ισοπαλία.
 */
export function sortCards(cards: ResultCard[], order: SortOrder = "price_asc"): ResultCard[] {
  const dir = order === "price_desc" ? -1 : 1;
  return [...cards].sort((a, b) => {
    const ab = isBookable(a);
    const bb = isBookable(b);
    if (ab !== bb) return ab ? -1 : 1;
    const pa = priceOf(a);
    const pb = priceOf(b);
    if (pa !== null && pb !== null && pa !== pb) return (pa - pb) * dir;
    if (pa === null && pb !== null) return 1;
    if (pb === null && pa !== null) return -1;
    return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  });
}

export { isBookable };
