// src/components/contracts/DamageSketch.tsx
// Κάτοψη αυτοκινήτου σε SVG με αριθμημένα σημάδια ζημιών.
//
// Χωρίς hooks: με `onAdd` γίνεται διαδραστικό (tap → νέο σημάδι στη θέση
// του δαχτύλου, σε % του σχεδίου), χωρίς αυτό είναι απλή εικόνα για το
// αντίγραφο εκτύπωσης.

import type { DamageMark } from "@/lib/contracts";

const W = 200;
const H = 360;

export default function DamageSketch({
  marks,
  onAdd,
  onSelect,
  selectedId,
  className,
}: {
  marks: DamageMark[];
  onAdd?: (x: number, y: number) => void;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  className?: string;
}) {
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onAdd) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onAdd(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      onClick={onAdd ? handleClick : undefined}
      role={onAdd ? "button" : "img"}
      aria-label="Car damage sketch"
      style={{ cursor: onAdd ? "crosshair" : undefined, touchAction: "manipulation" }}
    >
      {/* Αμάξωμα */}
      <rect x="40" y="20" width="120" height="320" rx="46" fill="#f8fafc" stroke="#475569" strokeWidth="3" />
      {/* Παρμπρίζ & πίσω τζάμι */}
      <path d="M58 110 Q100 88 142 110 L134 140 Q100 128 66 140 Z" fill="#e2e8f0" stroke="#475569" strokeWidth="2" />
      <path d="M64 250 Q100 262 136 250 L142 276 Q100 292 58 276 Z" fill="#e2e8f0" stroke="#475569" strokeWidth="2" />
      {/* Οροφή */}
      <rect x="66" y="144" width="68" height="102" rx="10" fill="none" stroke="#94a3b8" strokeWidth="2" />
      {/* Καθρέφτες */}
      <rect x="26" y="120" width="16" height="10" rx="3" fill="#cbd5e1" stroke="#475569" strokeWidth="1.5" />
      <rect x="158" y="120" width="16" height="10" rx="3" fill="#cbd5e1" stroke="#475569" strokeWidth="1.5" />
      {/* Τροχοί */}
      <rect x="30" y="62" width="12" height="40" rx="4" fill="#334155" />
      <rect x="158" y="62" width="12" height="40" rx="4" fill="#334155" />
      <rect x="30" y="262" width="12" height="40" rx="4" fill="#334155" />
      <rect x="158" y="262" width="12" height="40" rx="4" fill="#334155" />
      {/* Φανάρια */}
      <rect x="54" y="26" width="22" height="8" rx="3" fill="#fde68a" />
      <rect x="124" y="26" width="22" height="8" rx="3" fill="#fde68a" />
      <rect x="54" y="326" width="22" height="8" rx="3" fill="#fca5a5" />
      <rect x="124" y="326" width="22" height="8" rx="3" fill="#fca5a5" />
      {/* Εμπρός / Πίσω */}
      <text x="100" y="14" textAnchor="middle" fontSize="11" fill="#64748b">▲</text>

      {marks.map((m, i) => {
        const cx = (m.x / 100) * W;
        const cy = (m.y / 100) * H;
        const active = m.id === selectedId;
        return (
          <g
            key={m.id}
            // Χωρίς handlers όταν είναι απλή εικόνα: έτσι αποδίδεται και
            // από server component (αντίγραφο εκτύπωσης).
            onClick={
              onSelect
                ? (e) => {
                    e.stopPropagation();
                    onSelect(m.id);
                  }
                : undefined
            }
            style={{ cursor: onSelect ? "pointer" : undefined }}
          >
            <circle cx={cx} cy={cy} r={active ? 11 : 9} fill="#dc2626" stroke="#fff" strokeWidth="2" />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
