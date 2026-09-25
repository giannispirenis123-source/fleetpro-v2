-- prisma/sql/07-partner-commission.sql
--
-- Συνεργάτες: ποσοστό προμήθειας ανά χρήστη και σύνδεση κράτησης με τον
-- συνεργάτη που την έφερε.
--
-- Ασφαλές να τρέξει πολλές φορές (IF NOT EXISTS / DO blocks).
-- ΔΕΝ αλλάζει καμία υπάρχουσα εγγραφή: όλες οι σημερινές κρατήσεις
-- μένουν με partnerId NULL, δηλαδή χωρίς προμήθεια, και κάθε χρήστης
-- ξεκινά με ποσοστό 0.
--
-- Σειρά εκτέλεσης: 01-schema → 01b → 02b → 03 → 04 → 05 → 06 → 07,
-- και το 02-seed οποτεδήποτε μετά το 01-schema.

-- ── 1) Ποσοστό προμήθειας ανά χρήστη (αφορά μόνο PARTNER) ──
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "commissionRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- ── 2) Ποιος συνεργάτης έφερε την κράτηση ──
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "partnerId" TEXT;

-- ── 3) Index: κάθε λίστα συνεργάτη φιλτράρει με tenantId + partnerId ──
CREATE INDEX IF NOT EXISTS "bookings_tenantId_partnerId_idx"
  ON "bookings" ("tenantId", "partnerId");

-- ── 4) Ξένο κλειδί ──
-- ON DELETE SET NULL: αν κάποτε σβηστεί ο χρήστης, η κράτηση μένει στη
-- θέση της και απλώς παύει να έχει συνεργάτη. Η PostgreSQL δεν έχει
-- ADD CONSTRAINT IF NOT EXISTS, οπότε ελέγχουμε πρώτα.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_partnerId_fkey'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_partnerId_fkey"
      FOREIGN KEY ("partnerId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Έλεγχος ──
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'commissionRate')   AS "users.commissionRate",
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'bookings' AND column_name = 'partnerId')     AS "bookings.partnerId",
  (SELECT count(*) FROM pg_indexes
     WHERE indexname = 'bookings_tenantId_partnerId_idx')             AS "index",
  (SELECT count(*) FROM pg_constraint
     WHERE conname = 'bookings_partnerId_fkey')                       AS "foreign key",
  (SELECT count(*) FROM bookings WHERE "partnerId" IS NOT NULL)       AS "με συνεργάτη";
