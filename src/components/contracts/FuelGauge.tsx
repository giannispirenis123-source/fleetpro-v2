"use client";
// src/components/contracts/FuelGauge.tsx
// Δείκτης καυσίμου / μπαταρίας σε όγδοα: 9 κουμπιά (0/8 – 8/8) με tap.

import { FUEL_STEPS, fuelPercent } from "@/lib/contracts";

export default function FuelGauge({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number | null;
  onChange: (v: number) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="dash-fuel" role="radiogroup" aria-label={label}>
      <div className="dash-fuel-steps">
        {Array.from({ length: FUEL_STEPS + 1 }, (_, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            disabled={disabled}
            className={`dash-fuel-step ${value !== null && i <= value ? "on" : ""} ${
              value === i ? "current" : ""
            }`}
            onClick={() => onChange(i)}
            title={`${i}/8 · ${fuelPercent(i)}%`}
          >
            {i}
          </button>
        ))}
      </div>
      <span className="dash-fuel-value">
        {value === null ? "—" : `${value}/8 · ${fuelPercent(value)}%`}
      </span>
    </div>
  );
}
