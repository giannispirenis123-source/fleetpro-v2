-- prisma/sql/21-public-site-settings.sql
-- Δημόσιο site 1/4 — ρυθμίσεις κρατήσεων και δεδομένα της μηχανής τιμής.
--
-- Νέοι πίνακες (όλοι με "tenantId" → tenants, ON DELETE CASCADE):
-- · rental_groups     ομάδες ενοικίασης (π.χ. «B-MAN»), τιμή βάσης σε CENTS
-- · pickup_locations  σημεία παραλαβής/επιστροφής με έκπτωση/επιβάρυνση
-- · seasons           σεζόν ανά ημερομηνία 'MM-DD' (επιτρέπεται Δεκ → Ιαν)
-- · rates             κλίμακες τιμής ανά σεζόν × (ομάδα Ή όχημα), σε CENTS
-- · driver_age_bands  ηλικίες οδηγού με επιβάρυνση σε CENTS
-- Επεκτάσεις:
-- · vehicles: "rentalGroupId" (FK, ON DELETE SET NULL), "vehicleType" ('car'|'moto'|'atv')
-- · extras:   "nameI18n", "descriptionI18n" (JSONB ανά γλώσσα), "maxTotal" (€, Decimal
--             όπως η "price"), "maxQuantity", "vehicleTypes" TEXT[] (κενό = όλα), "sortOrder".
--             Τα ποσά των extras μένουν σε € (Decimal)· η μετατροπή σε cents γίνεται
--             μόνο στον κώδικα (src/lib/public/money.ts).
--             "isDefault" (BOOLEAN, false): η προεπιλεγμένη ΑΣΦΑΛΕΙΑ. Κανόνας: το πολύ
--             ΜΙΑ ασφάλεια ανά εταιρία και ανά τύπο οχήματος (κενό vehicleTypes = όλοι)·
--             τον εφαρμόζει το API, το verification τον ελέγχει. CHECK: μόνο INSURANCE.
-- · tenants."storefrontSettings": αφαιρείται το κλειδί "bookingMode" — ο τρόπος
--   κράτησης ζει ΜΟΝΟ στο tenants."rentalMode" (BOOKING = απευθείας, REQUEST = αίτημα).
--
-- Idempotent· σε transaction. Δεν πειράζει τα demo δεδομένα (βλ. 21b για δοκιμαστικά).

BEGIN;

/* ── rental_groups ─────────────────────────────── */
CREATE TABLE IF NOT EXISTS "rental_groups" (
  "id"              TEXT PRIMARY KEY,
  "tenantId"        TEXT NOT NULL,
  "code"            TEXT NOT NULL,
  "vehicleType"     TEXT NOT NULL DEFAULT 'car',
  "name"            JSONB NOT NULL DEFAULT '{}',
  "description"     JSONB NOT NULL DEFAULT '{}',
  "similarModels"   JSONB NOT NULL DEFAULT '{}',
  "seats"           INTEGER NOT NULL DEFAULT 5,
  "doors"           INTEGER,
  "transmission"    TEXT NOT NULL DEFAULT 'manual',
  "fuel"            "FuelType" NOT NULL DEFAULT 'PETROL',
  "bagsLarge"       INTEGER NOT NULL DEFAULT 0,
  "bagsSmall"       INTEGER NOT NULL DEFAULT 0,
  "airCondition"    BOOLEAN NOT NULL DEFAULT true,
  "engineCc"        INTEGER,
  "minDriverAge"    INTEGER,
  "licenceCategory" TEXT,
  "photos"          JSONB NOT NULL DEFAULT '[]',
  "basePriceCents"  INTEGER NOT NULL DEFAULT 0,
  "depositCents"    INTEGER,
  "excessCents"     INTEGER,
  "sortOrder"       INTEGER NOT NULL DEFAULT 0,
  "isPublic"        BOOLEAN NOT NULL DEFAULT true,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "rental_groups_tenantId_idx" ON "rental_groups" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "rental_groups_tenantId_code_key" ON "rental_groups" ("tenantId", "code");

/* ── vehicles ──────────────────────────────────── */
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "rentalGroupId" TEXT;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "vehicleType" TEXT NOT NULL DEFAULT 'car';
CREATE INDEX IF NOT EXISTS "vehicles_rentalGroupId_idx" ON "vehicles" ("rentalGroupId");
-- Αρχική τιμή: μηχανές → 'moto' (μόνο όσα είναι ακόμα στο προεπιλεγμένο 'car').
UPDATE "vehicles" SET "vehicleType" = 'moto'
  WHERE "category" = 'MOTORCYCLE' AND "vehicleType" = 'car';

/* ── pickup_locations ──────────────────────────── */
CREATE TABLE IF NOT EXISTS "pickup_locations" (
  "id"                 TEXT PRIMARY KEY,
  "tenantId"           TEXT NOT NULL,
  "slug"               TEXT NOT NULL,
  "name"               JSONB NOT NULL DEFAULT '{}',
  "type"               TEXT NOT NULL DEFAULT 'other',
  "address"            TEXT,
  "lat"                DOUBLE PRECISION,
  "lng"                DOUBLE PRECISION,
  "askFlightNumber"    BOOLEAN NOT NULL DEFAULT false,
  "askFerryName"       BOOLEAN NOT NULL DEFAULT false,
  "askAddress"         BOOLEAN NOT NULL DEFAULT false,
  "adjustmentType"     TEXT NOT NULL DEFAULT 'none',
  "adjustmentValue"    INTEGER NOT NULL DEFAULT 0,
  "adjustmentLabel"    JSONB NOT NULL DEFAULT '{}',
  "afterHoursFeeCents" INTEGER,
  "allowPickup"        BOOLEAN NOT NULL DEFAULT true,
  "allowDropoff"       BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"          INTEGER NOT NULL DEFAULT 0,
  "isActive"           BOOLEAN NOT NULL DEFAULT true,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "pickup_locations_tenantId_idx" ON "pickup_locations" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "pickup_locations_tenantId_slug_key" ON "pickup_locations" ("tenantId", "slug");

/* ── seasons ───────────────────────────────────── */
CREATE TABLE IF NOT EXISTS "seasons" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL,
  "name"          JSONB NOT NULL DEFAULT '{}',
  "startMonthDay" TEXT NOT NULL,
  "endMonthDay"   TEXT NOT NULL,
  "minDays"       INTEGER,
  "priority"      INTEGER NOT NULL DEFAULT 0,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "seasons_tenantId_idx" ON "seasons" ("tenantId");

/* ── rates ─────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS "rates" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL,
  "seasonId"      TEXT,
  "rentalGroupId" TEXT,
  "vehicleId"     TEXT,
  "tiers"         JSONB NOT NULL DEFAULT '[]',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "rates_tenantId_idx" ON "rates" ("tenantId");
-- Μία γραμμή ανά (σεζόν ή «όλο τον χρόνο») × (ομάδα ή όχημα). NULLS NOT
-- DISTINCT: δύο «όλο τον χρόνο» για την ίδια ομάδα δεν επιτρέπονται.
CREATE UNIQUE INDEX IF NOT EXISTS "rates_tenantId_seasonId_rentalGroupId_vehicleId_key"
  ON "rates" ("tenantId", "seasonId", "rentalGroupId", "vehicleId") NULLS NOT DISTINCT;

/* ── driver_age_bands ──────────────────────────── */
CREATE TABLE IF NOT EXISTS "driver_age_bands" (
  "id"                TEXT PRIMARY KEY,
  "tenantId"          TEXT NOT NULL,
  "minAge"            INTEGER NOT NULL,
  "maxAge"            INTEGER NOT NULL,
  "label"             JSONB NOT NULL DEFAULT '{}',
  "explanation"       JSONB NOT NULL DEFAULT '{}',
  "allowed"           BOOLEAN NOT NULL DEFAULT true,
  "isDefault"         BOOLEAN NOT NULL DEFAULT false,
  "surchargeType"     TEXT NOT NULL DEFAULT 'none',
  "surchargeCents"    INTEGER NOT NULL DEFAULT 0,
  "surchargeMaxCents" INTEGER,
  "sortOrder"         INTEGER NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "driver_age_bands_tenantId_idx" ON "driver_age_bands" ("tenantId");

/* ── extras (επέκταση) ─────────────────────────── */
ALTER TABLE "extras" ADD COLUMN IF NOT EXISTS "nameI18n" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "extras" ADD COLUMN IF NOT EXISTS "descriptionI18n" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "extras" ADD COLUMN IF NOT EXISTS "maxTotal" DECIMAL(10,2);
ALTER TABLE "extras" ADD COLUMN IF NOT EXISTS "maxQuantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "extras" ADD COLUMN IF NOT EXISTS "vehicleTypes" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "extras" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
-- Καμία υπάρχουσα τιμή δεν αλλάζει: όλα ξεκινούν false.
ALTER TABLE "extras" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;
-- Αρχική τιμή: το υπάρχον όνομα ως ελληνικό.
UPDATE "extras" SET "nameI18n" = jsonb_build_object('el', "name") WHERE "nameI18n" = '{}'::jsonb;

/* ── storefrontSettings: ο τρόπος κράτησης ΜΟΝΟ στο rentalMode ── */
UPDATE "tenants" SET "storefrontSettings" = "storefrontSettings" - 'bookingMode'
  WHERE "storefrontSettings" ? 'bookingMode';

/* ── Constraints (foreign keys + CHECK) ────────── */
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('rental_groups_tenantId_fkey',    'ALTER TABLE "rental_groups" ADD CONSTRAINT "rental_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('pickup_locations_tenantId_fkey', 'ALTER TABLE "pickup_locations" ADD CONSTRAINT "pickup_locations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('seasons_tenantId_fkey',          'ALTER TABLE "seasons" ADD CONSTRAINT "seasons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('rates_tenantId_fkey',            'ALTER TABLE "rates" ADD CONSTRAINT "rates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('rates_seasonId_fkey',            'ALTER TABLE "rates" ADD CONSTRAINT "rates_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('rates_rentalGroupId_fkey',       'ALTER TABLE "rates" ADD CONSTRAINT "rates_rentalGroupId_fkey" FOREIGN KEY ("rentalGroupId") REFERENCES "rental_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('rates_vehicleId_fkey',           'ALTER TABLE "rates" ADD CONSTRAINT "rates_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('driver_age_bands_tenantId_fkey', 'ALTER TABLE "driver_age_bands" ADD CONSTRAINT "driver_age_bands_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('vehicles_rentalGroupId_fkey',    'ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_rentalGroupId_fkey" FOREIGN KEY ("rentalGroupId") REFERENCES "rental_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    -- CHECK
    ('rental_groups_vehicleType_check',  'ALTER TABLE "rental_groups" ADD CONSTRAINT "rental_groups_vehicleType_check" CHECK ("vehicleType" IN (''car'',''moto'',''atv''))'),
    ('rental_groups_transmission_check', 'ALTER TABLE "rental_groups" ADD CONSTRAINT "rental_groups_transmission_check" CHECK ("transmission" IN (''manual'',''automatic''))'),
    ('vehicles_vehicleType_check',       'ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_vehicleType_check" CHECK ("vehicleType" IN (''car'',''moto'',''atv''))'),
    ('pickup_locations_type_check',      'ALTER TABLE "pickup_locations" ADD CONSTRAINT "pickup_locations_type_check" CHECK ("type" IN (''airport'',''port'',''office'',''city'',''hotel'',''other''))'),
    ('pickup_locations_adjustmentType_check', 'ALTER TABLE "pickup_locations" ADD CONSTRAINT "pickup_locations_adjustmentType_check" CHECK ("adjustmentType" IN (''none'',''percent'',''fixed''))'),
    ('seasons_monthday_check',           'ALTER TABLE "seasons" ADD CONSTRAINT "seasons_monthday_check" CHECK ("startMonthDay" ~ ''^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'' AND "endMonthDay" ~ ''^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'')'),
    ('rates_target_check',               'ALTER TABLE "rates" ADD CONSTRAINT "rates_target_check" CHECK (("rentalGroupId" IS NULL) <> ("vehicleId" IS NULL))'),
    ('driver_age_bands_surchargeType_check', 'ALTER TABLE "driver_age_bands" ADD CONSTRAINT "driver_age_bands_surchargeType_check" CHECK ("surchargeType" IN (''none'',''per_day'',''per_rental''))'),
    ('driver_age_bands_range_check',     'ALTER TABLE "driver_age_bands" ADD CONSTRAINT "driver_age_bands_range_check" CHECK ("minAge" <= "maxAge")'),
    ('extras_isDefault_insurance_check', 'ALTER TABLE "extras" ADD CONSTRAINT "extras_isDefault_insurance_check" CHECK (NOT "isDefault" OR "type" = ''INSURANCE'')')
  ) AS t(name, ddl)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE c.ddl;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Verification — αναμενόμενο:
--   new_tables = 5 · vehicle_columns = 2 · extras_columns = 7 · constraints = 19
--   unique_indexes = 3 · extras_without_name_el = 0 · tenants_with_bookingMode = 0
--   default_insurance_conflicts = 0
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name IN ('rental_groups','pickup_locations','seasons','rates','driver_age_bands')) AS new_tables,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name IN ('rentalGroupId','vehicleType')) AS vehicle_columns,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'extras'
      AND column_name IN ('nameI18n','descriptionI18n','maxTotal','maxQuantity','vehicleTypes','sortOrder','isDefault')) AS extras_columns,
  (SELECT count(*) FROM pg_constraint WHERE conname IN (
    'rental_groups_tenantId_fkey','pickup_locations_tenantId_fkey','seasons_tenantId_fkey','rates_tenantId_fkey',
    'rates_seasonId_fkey','rates_rentalGroupId_fkey','rates_vehicleId_fkey','driver_age_bands_tenantId_fkey',
    'vehicles_rentalGroupId_fkey','rental_groups_vehicleType_check','rental_groups_transmission_check',
    'vehicles_vehicleType_check','pickup_locations_type_check','pickup_locations_adjustmentType_check',
    'seasons_monthday_check','rates_target_check','driver_age_bands_surchargeType_check',
    'driver_age_bands_range_check','extras_isDefault_insurance_check')) AS constraints,
  (SELECT count(*) FROM pg_indexes WHERE indexname IN (
    'rental_groups_tenantId_code_key','pickup_locations_tenantId_slug_key',
    'rates_tenantId_seasonId_rentalGroupId_vehicleId_key')) AS unique_indexes,
  (SELECT count(*) FROM "extras" WHERE NOT ("nameI18n" ? 'el')) AS extras_without_name_el,
  (SELECT count(*) FROM "tenants" WHERE "storefrontSettings" ? 'bookingMode') AS tenants_with_bookingMode,
  -- Ζεύγη προεπιλεγμένων ασφαλειών της ίδιας εταιρίας που καλύπτουν κοινό τύπο οχήματος.
  (SELECT count(*) FROM "extras" a JOIN "extras" b
     ON a."tenantId" = b."tenantId" AND a."id" < b."id"
    WHERE a."type" = 'INSURANCE' AND b."type" = 'INSURANCE' AND a."isDefault" AND b."isDefault"
      AND (a."vehicleTypes" = '{}' OR b."vehicleTypes" = '{}' OR a."vehicleTypes" && b."vehicleTypes")) AS default_insurance_conflicts;
