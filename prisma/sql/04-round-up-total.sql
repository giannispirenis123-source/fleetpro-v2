-- prisma/sql/04-round-up-total.sql
--
-- Στρογγυλοποίηση τελικού ποσού κράτησης προς τα πάνω, ανά εταιρία.
--
-- Ασφαλές να τρέξει πολλές φορές (IF NOT EXISTS).
-- ΔΕΝ αλλάζει καμία υπάρχουσα συμπεριφορά: κάθε εταιρία ξεκινά με false,
-- δηλαδή ακριβείς τιμές με λεπτά, μέχρι να ανάψει τον διακόπτη από τις
-- Ρυθμίσεις.
--
-- Σειρά εκτέλεσης: 01-schema → 01b → 02b → 03 → 04 → 02-seed

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "roundUpTotal" BOOLEAN NOT NULL DEFAULT false;

-- Έλεγχος
SELECT count(*) AS "tenants.roundUpTotal"
  FROM information_schema.columns
 WHERE table_name = 'tenants' AND column_name = 'roundUpTotal';
