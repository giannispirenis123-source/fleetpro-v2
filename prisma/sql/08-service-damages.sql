-- prisma/sql/08-service-damages.sql
--
-- Service & Ζημιές.
--
-- ΠΡΟΣΟΧΗ: οι πίνακες "service_records" και "damages" ΥΠΑΡΧΟΥΝ ΗΔΗ από το
-- 01-schema, μαζί με τα enums "ServiceType" και "DamageStatus" και όλα τα
-- ξένα κλειδιά (το damages.bookingId είναι ήδη ON DELETE SET NULL).
-- Δεν δημιουργείται τίποτα από την αρχή.
--
-- Αυτό που ΟΝΤΩΣ λείπει και προστίθεται εδώ:
--   · damages."date" — πότε ΕΓΙΝΕ η ζημιά, ξεχωριστά από το πότε
--     καταχωρήθηκε (createdAt)
--   · τα indexes που χρειάζονται τα φίλτρα της σελίδας
--   · τα δικαιώματα service.* και damages.* στο Προσωπικό
--
-- Ασφαλές να τρέξει πολλές φορές. Οι υπάρχουσες ζημιές κρατούν τα δεδομένα
-- τους: το "date" γεμίζει από το "createdAt" τους.
--
-- Σειρά εκτέλεσης: 01-schema → 01b → 02b → 03 → 04 → 05 → 06 → 07 → 08,
-- και το 02-seed οποτεδήποτε μετά το 01-schema.

-- ── 1) Πότε έγινε η ζημιά ──
ALTER TABLE "damages"
  ADD COLUMN IF NOT EXISTS "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Οι ΥΠΑΡΧΟΥΣΕΣ ζημιές (και οι demo) παίρνουν την ημερομηνία καταχώρησής
-- τους, ώστε να μη δείχνουν όλες «σήμερα». Τρέχει μόνο μία φορά: μετά
-- από αυτό καμία γραμμή δεν έχει date = createdAt κατά λάθος ίσο με
-- την ώρα του migration.
UPDATE "damages"
SET "date" = "createdAt"
WHERE "date" > "createdAt";

-- ── 2) Indexes για τα φίλτρα της σελίδας ──
CREATE INDEX IF NOT EXISTS "service_records_tenantId_vehicleId_idx"
  ON "service_records" ("tenantId", "vehicleId");

-- Το ερώτημα «ποιο όχημα θέλει service σύντομα» στον Πίνακα.
CREATE INDEX IF NOT EXISTS "service_records_tenantId_nextServiceDate_idx"
  ON "service_records" ("tenantId", "nextServiceDate");

CREATE INDEX IF NOT EXISTS "damages_tenantId_vehicleId_idx"
  ON "damages" ("tenantId", "vehicleId");

CREATE INDEX IF NOT EXISTS "damages_tenantId_status_idx"
  ON "damages" ("tenantId", "status");

-- ── 3) Δικαιώματα ──
-- Το Προσωπικό αναλαμβάνει service και ζημιές· ο Συνεργάτης όχι.
-- Ο διαχειριστής τα έχει πάντα όλα, χωρίς εγγραφή στο πεδίο.
UPDATE "users"
SET "permissions" = "permissions" || '{
  "service.view": true,
  "service.create": true,
  "service.edit": true,
  "service.delete": true,
  "damages.view": true,
  "damages.create": true,
  "damages.edit": true,
  "damages.delete": true
}'::jsonb
WHERE "role" = 'STAFF'
  AND "tenantId" IS NOT NULL
  -- Μόνο σε όποιον δεν έχει ήδη ρυθμιστεί γι' αυτές τις ενότητες.
  AND NOT ("permissions" ?| ARRAY['service.view', 'damages.view']);

-- ── Έλεγχος ──
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'damages' AND column_name = 'date')          AS "damages.date",
  (SELECT count(*) FROM pg_indexes WHERE indexname IN (
     'service_records_tenantId_vehicleId_idx',
     'service_records_tenantId_nextServiceDate_idx',
     'damages_tenantId_vehicleId_idx',
     'damages_tenantId_status_idx'))                                 AS "indexes (4)",
  (SELECT count(*) FROM pg_constraint
     WHERE conname = 'damages_bookingId_fkey'
       AND confdeltype = 'n')                                        AS "bookingId SET NULL",
  (SELECT count(*) FROM "users"
     WHERE "role" = 'STAFF' AND "permissions" ? 'service.view')      AS "προσωπικό με service",
  (SELECT count(*) FROM "damages")                                   AS "ζημιές",
  (SELECT count(*) FROM "service_records")                           AS "εγγραφές service";
