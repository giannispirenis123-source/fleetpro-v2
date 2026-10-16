-- prisma/sql/25-optional-insurance.sql
-- Ασφάλεια = ΠΡΟΑΙΡΕΤΙΚΗ επιλογή του πελάτη · «Επίπεδα ασφάλειας» ανά εταιρία.
--
-- Τα επίπεδα ΕΙΝΑΙ οι γραμμές του υπάρχοντος πίνακα extras με type = 'INSURANCE'
-- (όνομα/περιγραφή ανά γλώσσα, τιμή, ανά ημέρα/ενοικίαση, ταβάνι, απαλλαγή,
-- τύποι οχημάτων, ενεργό, σειρά υπάρχουν ήδη). Προστίθεται ΜΟΝΟ:
--   · extras."coveragesI18n" — λίστα καλύψεων, μία γραμμή ανά κάλυψη:
--       [{"el":"Τροχοί & Ταμπλά","en":"Wheels & underbody"}, …]
-- Οι υπάρχουσες ασφάλειες μένουν ΩΣ ΕΧΟΥΝ (καμία απώλεια) και ξεκινούν με
-- κενή λίστα καλύψεων. Το "isDefault" ΔΕΝ σβήνεται — ο κώδικας απλώς δεν το
-- χρησιμοποιεί πια (καμία ασφάλεια δεν μπαίνει αυτόματα στην τιμή).
-- Μόνο προσθήκη με προεπιλογή: η παλιά έκδοση δουλεύει κανονικά μαζί του.
-- Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.

BEGIN;

ALTER TABLE "extras" ADD COLUMN IF NOT EXISTS "coveragesI18n" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Μόνο λίστα (ποτέ αντικείμενο/κείμενο).
UPDATE "extras" SET "coveragesI18n" = '[]'::jsonb WHERE jsonb_typeof("coveragesI18n") <> 'array';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'extras_coveragesI18n_array_check') THEN
    ALTER TABLE "extras"
      ADD CONSTRAINT "extras_coveragesI18n_array_check" CHECK (jsonb_typeof("coveragesI18n") = 'array');
  END IF;
END $$;

COMMIT;

-- Verification — αναμενόμενο: coverages_column = 1 · coverages_check = 1 · bad_rows = 0
-- (insurance_levels = πόσες ασφάλειες έχετε ήδη — γίνονται επίπεδα ως έχουν)
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'extras' AND column_name = 'coveragesI18n') AS coverages_column,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'extras_coveragesI18n_array_check') AS coverages_check,
  (SELECT count(*) FROM "extras" WHERE jsonb_typeof("coveragesI18n") <> 'array') AS bad_rows,
  (SELECT count(*) FROM "extras" WHERE "type" = 'INSURANCE') AS insurance_levels;
