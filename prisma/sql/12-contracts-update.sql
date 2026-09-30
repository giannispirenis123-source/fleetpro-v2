-- prisma/sql/12-contracts-update.sql
--
-- Συμβόλαια Φάση Α+:
--   · στοιχεία κάρτας ΜΟΝΟ για αναγνώριση (τύπος, 4 τελευταία ψηφία,
--     κάτοχος, λήξη) — ξεχωριστά για πληρωμή και εγγύηση. ΠΟΤΕ πλήρης
--     αριθμός ή CVV.
--   · κανονικοποιημένο κείμενο αναζήτησης "searchText" + GIN trigram index.
--     Τα υπάρχοντα συμβόλαια το αποκτούν αυτόματα (lazy backfill) την πρώτη
--     φορά που γίνεται αναζήτηση.
--
-- Καμία στήλη δεν σβήνεται. Ασφαλές να τρέξει πολλές φορές.
--
-- Σειρά εκτέλεσης: 01-schema → 01b → 02b → 03 → … → 11 → 12,
-- και το 02-seed οποτεδήποτε μετά το 01-schema.

-- ── 1) Κάρτες ──
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "paymentCard" JSONB;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "depositCard" JSONB;

-- ── 2) Αναζήτηση ──
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "searchText" TEXT;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "contracts_searchText_trgm_idx"
  ON "contracts" USING GIN ("searchText" gin_trgm_ops);

-- ── Έλεγχος ── (αναμενόμενο: 3 | 1 | 1)
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'contracts'
       AND column_name IN ('paymentCard', 'depositCard', 'searchText'))  AS "στήλες (3)",
  (SELECT count(*) FROM pg_extension WHERE extname = 'pg_trgm')         AS "pg_trgm (1)",
  (SELECT count(*) FROM pg_indexes
     WHERE indexname = 'contracts_searchText_trgm_idx')                  AS "index (1)";
