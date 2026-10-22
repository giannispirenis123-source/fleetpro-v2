"use client";
// src/components/lists/useServerList.ts
// Μια σελιδοποιημένη λίστα του dashboard (κρατήσεις, πελάτες, τιμολόγια): ίδια
// συμπεριφορά με τα συμβόλαια. Αλλαγή φίλτρου/αναζήτησης → σελίδα 1· η
// αναζήτηση με μικρή καθυστέρηση (όχι αίτημα ανά πλήκτρο)· παλιές απαντήσεις
// αγνοούνται. Τα φίλτρα και η αναζήτηση κρατιούνται σε κάθε αλλαγή σελίδας.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ListPage } from "@/lib/pagination";

export function useServerList<P extends ListPage<unknown>>(
  endpoint: string,
  initial: P,
  /** Φίλτρα + αναζήτηση (κενή τιμή = παραλείπεται). */
  params: Record<string, string>,
  errorText: { load: string; connection: string }
) {
  const [data, setData] = useState<P>(initial);
  const [page, setPage] = useState(initial.page || 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const seq = useRef(0);
  const first = useRef(true);
  const key = JSON.stringify(params);
  const prevKey = useRef(key);

  // Νέο φίλτρο/αναζήτηση → από την αρχή.
  if (prevKey.current !== key) {
    prevKey.current = key;
    if (page !== 1) setPage(1);
  }

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(JSON.parse(key) as Record<string, string>)) if (v) qs.set(k, v);
        qs.set("page", String(page));
        const res = await fetch(`${endpoint}?${qs}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (mine !== seq.current) return;
        if (!res.ok) {
          setError(body.message || errorText.load);
          return;
        }
        setData(body.data as P);
      } catch {
        if (mine === seq.current) setError(errorText.connection);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, key, page, reloadKey]);

  /** Μετά από δημιουργία/αλλαγή/διαγραφή: ξανά η ίδια σελίδα με τα ίδια φίλτρα. */
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { data, setData, page, setPage, loading, error, reload };
}
