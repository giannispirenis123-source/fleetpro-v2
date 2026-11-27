"use client";
// src/components/storefront/TypeTabs.tsx
// Καρτέλες τύπου οχήματος (Αυτοκίνητα / Μηχανές / ATV) ΠΑΝΩ από τη φόρμα
// αναζήτησης. Φαίνονται μόνο οι τύποι που έχουν κάρτες· ένας τύπος → καθόλου
// καρτέλες (typeTabs στο catalog.ts). Η επιλογή:
//   · γράφεται στο URL (?type=) με history.replaceState — ΧΩΡΙΣ νέο φόρτωμα,
//     άρα δουλεύουν το link και το refresh·
//   · ενημερώνει τις κάρτες (Results) και τη φόρμα (SearchBox) με TYPE_EVENT.

import { useEffect, useState } from "react";
import type { StorefrontDictionary } from "@/lib/storefront/i18n";
import type { VehicleType } from "@/lib/public/pricing";

/** Αλλαγή καρτέλας: detail = { type }. */
export const TYPE_EVENT = "sf:type";

export function setUrlType(type: VehicleType | null) {
  try {
    const u = new URL(window.location.href);
    if (type) u.searchParams.set("type", type);
    else u.searchParams.delete("type");
    window.history.replaceState(window.history.state, "", u.toString());
  } catch {
    /* χωρίς URL API: απλώς δεν αλλάζει η διεύθυνση */
  }
}

interface Props {
  tabs: VehicleType[];
  /** Η ενεργή καρτέλα, όπως την υπολόγισε ο server (activeType). */
  initial: VehicleType | null;
  d: StorefrontDictionary;
}

export default function TypeTabs({ tabs, initial, d }: Props) {
  const [type, setType] = useState<VehicleType | null>(initial);

  // Π.χ. «Δείτε τιμές» από κάρτα άλλου τύπου: η καρτέλα ακολουθεί.
  useEffect(() => {
    const onType = (e: Event) => setType((e as CustomEvent<{ type: VehicleType | null }>).detail?.type ?? null);
    window.addEventListener(TYPE_EVENT, onType);
    return () => window.removeEventListener(TYPE_EVENT, onType);
  }, []);

  if (tabs.length === 0) return null;

  const choose = (t: VehicleType) => {
    if (t === type) return;
    setUrlType(t);
    window.dispatchEvent(new CustomEvent(TYPE_EVENT, { detail: { type: t } }));
  };

  return (
    <div className="sf-tabs sf-type-tabs" role="group" aria-label={d.vehicleTypes}>
      {tabs.map((t) => (
        <button key={t} type="button" className="sf-tab" aria-pressed={type === t} onClick={() => choose(t)}>
          {d.tabTypes[t] ?? t}
        </button>
      ))}
    </div>
  );
}
