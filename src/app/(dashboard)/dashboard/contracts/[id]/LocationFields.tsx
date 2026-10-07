"use client";
// Τοποθεσία παραλαβής / επιστροφής: δύο combobox (λίστα σημείων της εταιρίας
// ή ελεύθερο κείμενο) δίπλα-δίπλα (σε κινητό το ένα κάτω από το άλλο) και
// «Επιστροφή στο ίδιο σημείο». Η λίστα έρχεται από το tenantLocations.

import { useId } from "react";
import { useT } from "@/lib/i18n/I18nProvider";

export function LocationFields({
  pickup,
  ret,
  returnSame,
  locations,
  disabled,
  onPickup,
  onReturn,
  onReturnSame,
}: {
  pickup: string;
  ret: string;
  returnSame: boolean;
  locations: string[];
  disabled: boolean;
  onPickup: (v: string) => void;
  onReturn: (v: string) => void;
  onReturnSame: (same: boolean) => void;
}) {
  const tr = useT();
  const listId = useId();

  return (
    <div className="dash-locations">
      <div className="dash-form-grid">
        <label className="dash-field">
          {tr("contracts.pickupLocation")}
          <input
            list={listId}
            value={pickup}
            disabled={disabled}
            maxLength={200}
            autoComplete="off"
            placeholder={tr("contracts.locationPlaceholder")}
            onChange={(e) => onPickup(e.target.value)}
          />
        </label>
        <label className="dash-field">
          {tr("contracts.returnLocation")}
          <input
            list={listId}
            value={returnSame ? pickup : ret}
            disabled={disabled || returnSame}
            maxLength={200}
            autoComplete="off"
            placeholder={tr("contracts.locationPlaceholder")}
            onChange={(e) => onReturn(e.target.value)}
          />
        </label>
      </div>
      <datalist id={listId}>
        {locations.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <label className="dash-field dash-field--check">
        <input
          type="checkbox"
          checked={returnSame}
          disabled={disabled}
          onChange={(e) => onReturnSame(e.target.checked)}
        />
        {tr("contracts.returnSamePlace")}
      </label>
    </div>
  );
}
