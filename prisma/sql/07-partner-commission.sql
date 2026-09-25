-- prisma/sql/07-partner-commission.sql
--
-- Προμήθεια ανά χρήστη και σήμανση «ποιος έκανε τι».
--
-- ΕΝΟΠΟΙΗΜΕΝΟ migration: περιέχει και τα πεδία της πρώτης έκδοσης
-- (commissionRate, bookings.partnerId) και την επέκταση (τρεις διακόπτες
-- βάσης προμήθειας, bookings.createdById). Τρέχει μία φορά, ή πολλές —
-- είναι ασφαλές (IF NOT EXISTS / DO blocks).
--
-- ΔΕΝ αλλάζει καμία υπάρχουσα εγγραφή:
--   · κάθε χρήστης ξεκινά με ποσοστό 0, άρα καμία προμήθεια
--   · οι διακόπτες ξεκινούν «μόνο ενοίκιο», όπως ίσχυε εξ αρχής
--   · κάθε υπάρχουσα κράτηση μένει με partnerId και createdById NULL
--
-- Σειρά εκτέλεσης: 01-schema → 01b → 02b → 03 → 04 → 05 → 06 → 07,
-- και το 02-seed οποτεδήποτε μετά το 01-schema.

-- ── 1) Προμήθεια ανά χρήστη ──
-- Το ποσοστό αφορά συνεργάτες ΚΑΙ προσωπικό. Οι τρεις διακόπτες λένε
-- πάνω σε τι υπολογίζεται· προεπιλογή μόνο το ενοίκιο.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "commissionRate"        DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "commissionOnRental"    BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "commissionOnExtras"    BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "commissionOnInsurance" BOOLEAN      NOT NULL DEFAULT false;

-- ── 2) Ποιος έφερε και ποιος καταχώρησε την κράτηση ──
-- partnerId   = ο συνεργάτης που την έφερε
-- createdById = ο χρήστης που την έγραψε στο σύστημα
-- Είναι ξεχωριστά: ο υπάλληλος που γράφει μια κράτηση δεν είναι
-- απαραίτητα ο συνεργάτης που την έφερε.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "partnerId"   TEXT,
  ADD COLUMN IF NOT EXISTS "createdById" TEXT;

-- ── 3) Index: κάθε «οι κρατήσεις μου» φιλτράρει με tenantId + χρήστη ──
CREATE INDEX IF NOT EXISTS "bookings_tenantId_partnerId_idx"
  ON "bookings" ("tenantId", "partnerId");

CREATE INDEX IF NOT EXISTS "bookings_tenantId_createdById_idx"
  ON "bookings" ("tenantId", "createdById");

-- ── 4) Ξένα κλειδιά ──
-- ON DELETE SET NULL: αν κάποτε σβηστεί ο χρήστης, η κράτηση μένει στη
-- θέση της και απλώς χάνει τη σήμανση. Η PostgreSQL δεν έχει
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

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_createdById_fkey'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 5) Το δικαίωμα προβολής προμήθειας άλλαξε όνομα ──
-- Ήταν "partner.commission.view"· τώρα λέγεται "commission.view", γιατί
-- ισχύει και για το προσωπικό. Μεταφέρουμε όποιον το είχε, ώστε να μη
-- χάσει την προβολή της προμήθειάς του.
UPDATE "users"
SET "permissions" =
      ("permissions" - 'partner.commission.view')
      || '{"commission.view": true}'::jsonb
WHERE "permissions" ? 'partner.commission.view';

-- ── Έλεγχος ──
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'users' AND column_name IN
       ('commissionRate','commissionOnRental','commissionOnExtras','commissionOnInsurance'))  AS "users (4)",
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'bookings' AND column_name IN ('partnerId','createdById'))            AS "bookings (2)",
  (SELECT count(*) FROM pg_indexes
     WHERE indexname IN ('bookings_tenantId_partnerId_idx','bookings_tenantId_createdById_idx')) AS "indexes (2)",
  (SELECT count(*) FROM pg_constraint
     WHERE conname IN ('bookings_partnerId_fkey','bookings_createdById_fkey'))                AS "foreign keys (2)",
  (SELECT count(*) FROM "users" WHERE "permissions" ? 'partner.commission.view')              AS "παλιό κλειδί (0)",
  (SELECT count(*) FROM "bookings" WHERE "partnerId" IS NOT NULL OR "createdById" IS NOT NULL) AS "σημασμένες (0)";
