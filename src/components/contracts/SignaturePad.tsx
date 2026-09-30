"use client";
// src/components/contracts/SignaturePad.tsx
// Υπογραφή με ποντίκι ή δάχτυλο (Pointer Events). Επιστρέφει PNG σε
// data URL μόνο όταν ο χρήστης πατήσει «Αποθήκευση υπογραφής».

import { useEffect, useRef, useState } from "react";

export default function SignaturePad({
  onSave,
  onCancel,
  busy,
  labels,
}: {
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
  busy?: boolean;
  labels: { clear: string; save: string; cancel: string; hint: string };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // Το canvas παίρνει το πραγματικό πλάτος του (και την πυκνότητα της
  // οθόνης), ώστε η γραμμή να είναι καθαρή και στο κινητό.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = e.currentTarget.getContext("2d");
    if (ctx && last.current) {
      // Τελεία για ένα απλό άγγιγμα.
      ctx.beginPath();
      ctx.arc(last.current.x, last.current.y, 1, 0, Math.PI * 2);
      ctx.fillStyle = "#0f172a";
      ctx.fill();
    }
    setEmpty(false);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    e.preventDefault();
    const ctx = e.currentTarget.getContext("2d");
    const p = point(e);
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
  };

  const up = () => {
    drawing.current = false;
    last.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setEmpty(true);
  };

  return (
    <div className="dash-sign">
      <canvas
        ref={canvasRef}
        className="dash-sign-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      />
      <p className="dash-form-note">{labels.hint}</p>
      <div className="dash-sign-actions">
        <button type="button" className="dash-btn" onClick={clear} disabled={busy}>
          {labels.clear}
        </button>
        <button type="button" className="dash-btn" onClick={onCancel} disabled={busy}>
          {labels.cancel}
        </button>
        <button
          type="button"
          className="dash-btn dash-btn--primary"
          disabled={empty || busy}
          onClick={() => canvasRef.current && onSave(canvasRef.current.toDataURL("image/png"))}
        >
          {labels.save}
        </button>
      </div>
    </div>
  );
}
