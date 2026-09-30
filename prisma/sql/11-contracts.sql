-- prisma/sql/11-contracts.sql
--
-- Συμβόλαια ενοικίασης: δίγλωσσο συμβόλαιο από κράτηση, οδηγοί με
-- ψηφιακή υπογραφή, καύσιμο, σκαρίφημα ζημιών, αλλαγές οχήματος.
--
-- ΠΡΟΣΟΧΗ: οι πίνακες "contracts" και "contract_templates" ΥΠΑΡΧΟΥΝ ΗΔΗ
-- από το 01-schema. Εδώ προστίθενται μόνο στήλες, ένα enum, ένα unique
-- index και ένα απλό index. Καμία στήλη δεν σβήνεται.
--
-- Επίσης:
--   · tenants: ΔΟΥ, περιοχή, όροι ενοικίασης ΕΛ/EN
--   · extras: απαλλαγή (excess) για τις ασφάλειες
--   · δικαιώματα: το παλιό "contracts.sign" γίνεται "contracts.edit"·
--     το Προσωπικό (STAFF) παίρνει contracts.view/create/edit (ΟΧΙ delete).
--
-- Ασφαλές να τρέξει πολλές φορές.
--
-- Σειρά εκτέλεσης: 01-schema → 01b → 02b → 03 → … → 10 → 11,
-- και το 02-seed οποτεδήποτε μετά το 01-schema.

-- ── 1) Enum κατάστασης συμβολαίου ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContractStatus') THEN
    CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SIGNED', 'COMPLETED');
  END IF;
END $$;

-- ── 2) Στοιχεία εταιρίας και όροι ──
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "taxOffice"       TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "region"          TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "contractTermsEl" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "contractTermsEn" TEXT;

-- ── 3) Απαλλαγή ασφάλειας ──
ALTER TABLE "extras" ADD COLUMN IF NOT EXISTS "excess" DECIMAL(10,2);

-- ── 4) Στήλες συμβολαίου ──
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "status"         "ContractStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "createdById"    TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "createdByName"  TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "snapshot"       JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "drivers"        JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "pickupLocation" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "returnLocation" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "fuelPickup"     INTEGER;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "fuelReturn"     INTEGER;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "damageMarks"    JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "vehicleChanges" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "notes"          TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "paymentMethod"  TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "depositAmount"  DECIMAL(10,2);
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "depositMethod"  TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "gdprConsent"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "gdprConsentAt"  TIMESTAMP(3);
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "completedAt"    TIMESTAMP(3);

-- Το παλιό πεδίο HTML δεν χρησιμοποιείται πια· παίρνει κενή προεπιλογή.
ALTER TABLE "contracts" ALTER COLUMN "content" SET DEFAULT '';

-- ── 5) Ο κωδικός συμβολαίου είναι μοναδικός ΜΕΣΑ στην εταιρία ──
CREATE UNIQUE INDEX IF NOT EXISTS "contracts_tenantId_contractNumber_key"
  ON "contracts" ("tenantId", "contractNumber");

CREATE INDEX IF NOT EXISTS "contracts_tenantId_status_idx"
  ON "contracts" ("tenantId", "status");

-- ── 6) Δικαιώματα: contracts.sign → contracts.edit ──
-- Μόνο όποιος το είχε ήδη ενεργό. Το παλιό κλειδί αφαιρείται.
UPDATE "users"
SET "permissions" = ("permissions" - 'contracts.sign')
                    || '{"contracts.edit": true}'::jsonb
WHERE "permissions" ? 'contracts.sign'
  AND "permissions" ->> 'contracts.sign' = 'true';

UPDATE "users"
SET "permissions" = "permissions" - 'contracts.sign'
WHERE "permissions" ? 'contracts.sign';

-- ── 7) Το Προσωπικό παίρνει προβολή / δημιουργία / επεξεργασία ──
-- Μόνο όσοι δεν έχουν ήδη ρυθμιστεί για τα συμβόλαια. ΟΧΙ delete.
UPDATE "users"
SET "permissions" = "permissions" || '{
  "contracts.view": true,
  "contracts.create": true,
  "contracts.edit": true
}'::jsonb
WHERE "role" = 'STAFF'
  AND "tenantId" IS NOT NULL
  AND NOT ("permissions" ? 'contracts.view');

-- ── Έλεγχος ── (αναμενόμενο: 1 | 4 | 1 | 18 | 2 | 0 | 0)
-- Η τελευταία στήλη = προσωπικό ΧΩΡΙΣ contracts.view (πρέπει 0).
SELECT
  (SELECT count(*) FROM pg_type WHERE typname = 'ContractStatus')        AS "enum (1)",
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'tenants' AND column_name IN
       ('taxOffice', 'region', 'contractTermsEl', 'contractTermsEn'))    AS "tenants (4)",
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'extras' AND column_name = 'excess')             AS "extras (1)",
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'contracts' AND column_name IN
       ('status', 'createdById', 'createdByName', 'snapshot', 'drivers',
        'pickupLocation', 'returnLocation', 'fuelPickup', 'fuelReturn',
        'damageMarks', 'vehicleChanges', 'notes', 'paymentMethod',
        'depositAmount', 'depositMethod', 'gdprConsent', 'gdprConsentAt',
        'completedAt'))                                                  AS "contracts (18)",
  (SELECT count(*) FROM pg_indexes WHERE indexname IN (
     'contracts_tenantId_contractNumber_key',
     'contracts_tenantId_status_idx'))                                   AS "indexes (2)",
  (SELECT count(*) FROM "users"
     WHERE "permissions" ? 'contracts.sign')                             AS "παλιό contracts.sign (0)",
  (SELECT count(*) FROM "users"
     WHERE "role" = 'STAFF' AND "tenantId" IS NOT NULL
       AND NOT ("permissions" ? 'contracts.view'))                       AS "STAFF χωρίς view (0)";
