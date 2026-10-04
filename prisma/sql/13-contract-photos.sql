-- prisma/sql/13-contract-photos.sql
-- Φάση Β (1ο κομμάτι): φωτογραφίες ζημιών στο συμβόλαιο.
--
-- · contracts."damagePhotos"      JSONB  [{ id, path, group, takenAt, note }]
-- · contracts."damageNotesPickup" TEXT   ελεύθερη περιγραφή ζημιών παραλαβής
-- · contracts."damageNotesReturn" TEXT   ελεύθερη περιγραφή ζημιών παράδοσης
--
-- ΔΕΝ σβήνεται τίποτα: τα "damageMarks" (παλιό σκαρίφημα) και το
-- "fuelReturn" μένουν για τα παλιά συμβόλαια. Οι φωτογραφίες ζημιών της
-- σελίδας Service χρησιμοποιούν το υπάρχον damages."photos" (TEXT[]).
--
-- Idempotent: τρέχει όσες φορές χρειαστεί.

ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "damagePhotos" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "damageNotesPickup" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "damageNotesReturn" TEXT;

-- Verification: αναμενόμενο  3 | 0
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'contracts'
      AND column_name IN ('damagePhotos', 'damageNotesPickup', 'damageNotesReturn')) AS new_columns,
  (SELECT count(*) FROM "contracts"
    WHERE jsonb_typeof("damagePhotos") <> 'array') AS bad_rows;
