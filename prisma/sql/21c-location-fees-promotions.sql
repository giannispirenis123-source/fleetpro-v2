-- prisma/sql/21c-location-fees-promotions.sql
-- Δημόσιο site 1/4 (συμπλήρωμα): χρεώσεις δρομολογίου ανά τοποθεσία + προσφορές.
-- Τρέχει ΜΕΤΑ τα 21 / 21b (που έχουν ήδη τρέξει και ΔΕΝ αλλάζουν).
--
-- 1) pickup_locations: χωριστές χρεώσεις ανά σκέλος (σε CENTS)
--    · "deliveryFeeCents"   — όταν ο πελάτης ΠΑΡΑΛΑΜΒΑΝΕΙ το όχημα εκεί
--    · "collectionFeeCents" — όταν το ΕΠΙΣΤΡΕΦΕΙ εκεί
--    · "feeFreeFromDays"    — από τόσες ημέρες και πάνω οι δύο χρεώσεις = 0 (NULL = ποτέ)
--    · "feeLabel"           — κείμενο ανά γλώσσα (π.χ. «Παράδοση στο Ηράκλειο»)
--    Μεταφορά: όπου adjustmentType = 'fixed' με ΘΕΤΙΚΟ ποσό → το ποσό πάει ΚΑΙ στα
--    δύο fees, το adjustmentLabel στο feeLabel, και adjustmentType = 'none', value = 0.
--    Τρέχει μόνο σε γραμμές που έχουν ακόμα 'fixed' > 0 (idempotent). Η έκπτωση
--    τοποθεσίας μένει μόνο 'percent'· ο CHECK με 'fixed' μένει για συμβατότητα.
-- 2) promotions: προσφορές/εκπτώσεις με πραγματικές ημερομηνίες (DATE).
--    Κενή λίστα (locationIds, rentalGroupIds, vehicleIds, vehicleTypes) = όλα.
-- 3) Demo (εταιρία με slug 'p-rentals'): μία ΑΝΕΝΕΡΓΗ προσφορά-παράδειγμα.
--
-- Idempotent· σε transaction.

BEGIN;

/* ── 1) Χρεώσεις δρομολογίου ─────────────────────── */
ALTER TABLE "pickup_locations" ADD COLUMN IF NOT EXISTS "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pickup_locations" ADD COLUMN IF NOT EXISTS "collectionFeeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pickup_locations" ADD COLUMN IF NOT EXISTS "feeFreeFromDays" INTEGER;
ALTER TABLE "pickup_locations" ADD COLUMN IF NOT EXISTS "feeLabel" JSONB NOT NULL DEFAULT '{}';

UPDATE "pickup_locations"
SET "deliveryFeeCents"   = "adjustmentValue",
    "collectionFeeCents" = "adjustmentValue",
    "feeLabel"           = "adjustmentLabel",
    "adjustmentType"     = 'none',
    "adjustmentValue"    = 0,
    "adjustmentLabel"    = '{}',
    "updatedAt"          = CURRENT_TIMESTAMP
WHERE "adjustmentType" = 'fixed' AND "adjustmentValue" > 0;

/* ── 2) Προσφορές ─────────────────────────────────── */
CREATE TABLE IF NOT EXISTS "promotions" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL,
  "name"           JSONB NOT NULL DEFAULT '{}',
  "badge"          JSONB NOT NULL DEFAULT '{}',
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "discountType"   TEXT NOT NULL DEFAULT 'percent',
  "discountValue"  INTEGER NOT NULL,
  "validFrom"      DATE NOT NULL,
  "validTo"        DATE NOT NULL,
  "locationIds"    TEXT[] NOT NULL DEFAULT '{}',
  "locationMatch"  TEXT NOT NULL DEFAULT 'pickup',
  "rentalGroupIds" TEXT[] NOT NULL DEFAULT '{}',
  "vehicleIds"     TEXT[] NOT NULL DEFAULT '{}',
  "vehicleTypes"   TEXT[] NOT NULL DEFAULT '{}',
  "minDays"        INTEGER,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "promotions_tenantId_idx" ON "promotions" ("tenantId");
CREATE INDEX IF NOT EXISTS "promotions_tenantId_isActive_idx" ON "promotions" ("tenantId", "isActive");

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('promotions_tenantId_fkey',
     'ALTER TABLE "promotions" ADD CONSTRAINT "promotions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('promotions_discountType_check',
     'ALTER TABLE "promotions" ADD CONSTRAINT "promotions_discountType_check" CHECK ("discountType" IN (''percent'',''per_day'',''per_rental''))'),
    ('promotions_locationMatch_check',
     'ALTER TABLE "promotions" ADD CONSTRAINT "promotions_locationMatch_check" CHECK ("locationMatch" IN (''pickup'',''dropoff'',''either''))'),
    ('promotions_dates_check',
     'ALTER TABLE "promotions" ADD CONSTRAINT "promotions_dates_check" CHECK ("validFrom" <= "validTo")'),
    ('promotions_value_check',
     'ALTER TABLE "promotions" ADD CONSTRAINT "promotions_value_check" CHECK ("discountValue" > 0 AND ("discountType" <> ''percent'' OR "discountValue" <= 90))'),
    ('pickup_locations_fees_check',
     'ALTER TABLE "pickup_locations" ADD CONSTRAINT "pickup_locations_fees_check" CHECK ("deliveryFeeCents" >= 0 AND "collectionFeeCents" >= 0 AND ("feeFreeFromDays" IS NULL OR "feeFreeFromDays" >= 1))')
  ) AS t(name, ddl)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE c.ddl;
    END IF;
  END LOOP;
END $$;

/* ── 3) Demo: «-15% Κατηγορίες A–B, 01/11–15/12, παραλαβή Αεροδρόμιο Χανίων, από 3 ημέρες» (ανενεργή) ── */
DO $$
DECLARE
  v_slug   TEXT := 'p-rentals';
  v_tenant TEXT;
BEGIN
  SELECT "id" INTO v_tenant FROM "tenants" WHERE "slug" = v_slug;
  IF v_tenant IS NULL THEN
    RAISE NOTICE 'Δεν βρέθηκε εταιρία με slug %, η demo προσφορά παραλείπεται.', v_slug;
    RETURN;
  END IF;

  INSERT INTO "promotions"
    ("id","tenantId","name","badge","isActive","discountType","discountValue","validFrom","validTo",
     "locationIds","locationMatch","rentalGroupIds","minDays","sortOrder")
  SELECT
    'psd_' || left(md5(v_tenant || ':promo:autumn-ab'), 20), v_tenant,
    '{"el":"Φθινόπωρο A–B αεροδρόμιο","en":"Autumn A–B airport"}'::jsonb,
    '{"el":"Προσφορά φθινοπώρου","en":"Autumn offer"}'::jsonb,
    false, 'percent', 15,
    make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 11, 1),
    make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 12, 15),
    COALESCE((SELECT array_agg(l."id") FROM "pickup_locations" l
               WHERE l."tenantId" = v_tenant AND l."slug" = 'chania-airport'), '{}'),
    'pickup',
    COALESCE((SELECT array_agg(g."id" ORDER BY g."code") FROM "rental_groups" g
               WHERE g."tenantId" = v_tenant AND (g."code" LIKE 'A-%' OR g."code" LIKE 'B-%')), '{}'),
    3, 10
  ON CONFLICT DO NOTHING;
END $$;

COMMIT;

-- Verification — αναμενόμενο:
--   location_fee_columns = 4 · fixed_positive_left = 0 · promotions_table = 1
--   constraints = 6 · indexes = 2 · demo_promotions = 1
-- (demo_promotions = 0 αν δεν υπάρχει εταιρία με slug 'p-rentals'.)
-- Ενημερωτικά: fixed_negative_left = παλιές σταθερές ΕΚΠΤΩΣΕΙΣ τοποθεσίας που δεν
-- μεταφέρθηκαν και δεν εφαρμόζονται πια (αναμενόμενο 0).
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'pickup_locations'
      AND column_name IN ('deliveryFeeCents','collectionFeeCents','feeFreeFromDays','feeLabel')) AS location_fee_columns,
  (SELECT count(*) FROM "pickup_locations" WHERE "adjustmentType" = 'fixed' AND "adjustmentValue" > 0) AS fixed_positive_left,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'promotions') AS promotions_table,
  (SELECT count(*) FROM pg_constraint WHERE conname IN (
    'promotions_tenantId_fkey','promotions_discountType_check','promotions_locationMatch_check',
    'promotions_dates_check','promotions_value_check','pickup_locations_fees_check')) AS constraints,
  (SELECT count(*) FROM pg_indexes WHERE indexname IN ('promotions_tenantId_idx','promotions_tenantId_isActive_idx')) AS indexes,
  (SELECT count(*) FROM "promotions" p JOIN "tenants" t ON t."id" = p."tenantId"
    WHERE t."slug" = 'p-rentals' AND p."id" LIKE 'psd_%') AS demo_promotions,
  (SELECT count(*) FROM "pickup_locations" WHERE "adjustmentType" = 'fixed' AND "adjustmentValue" <= 0) AS fixed_negative_left;
