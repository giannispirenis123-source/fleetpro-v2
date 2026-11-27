-- prisma/sql/42-enable-rls.sql
-- Ενεργοποίηση Row Level Security (RLS) σε ΟΛΟΥΣ τους πίνακες του schema public.
--   · ΧΩΡΙΣ policies: η εφαρμογή συνδέεται μέσω Prisma (ρόλος postgres, παρακάμπτει
--     το RLS), οπότε δεν αλλάζει τίποτα για την εφαρμογή. Κλείνει όμως την πρόσβαση
--     από το δημόσιο Supabase API (anon / authenticated).
--   · Idempotent: αν το RLS είναι ήδη ενεργό, το ALTER δεν κάνει καμία αλλαγή.
-- ΕΤΡΕΞΕ ΗΔΗ στην παραγωγή στις 23/11/2026 από το Supabase SQL Editor.
-- Το αρχείο μπαίνει στο repo για ιστορικό· ΔΕΝ χρειάζεται να ξανατρέξει.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END
$$;
