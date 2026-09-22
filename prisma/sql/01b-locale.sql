-- prisma/sql/01b-locale.sql
--
-- Προτίμηση γλώσσας ανά χρήστη (EL/EN).
-- Αντιστοιχεί στο commit 97e0236 «feat: add per-user i18n (EL/EN)».
--
-- ΗΔΗ ΕΦΑΡΜΟΣΜΕΝΟ στην παραγωγή. Το αρχείο υπάρχει ώστε το schema να
-- ξαναστήνεται από το μηδέν· είναι ασφαλές να ξανατρέξει.
--
-- Σειρά εκτέλεσης: 01-schema.sql → 01b → 02b → 03 → 02-seed.sql

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'el';

-- Έλεγχος
SELECT count(*) AS "users.locale"
  FROM information_schema.columns
 WHERE table_name = 'users' AND column_name = 'locale';
