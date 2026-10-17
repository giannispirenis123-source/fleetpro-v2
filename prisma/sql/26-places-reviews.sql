-- prisma/sql/26-places-reviews.sql
-- Δημόσιο site: «Μέρη για επίσκεψη» και «Κριτικές πελατών».
--   · places          — μέρη ανά εταιρία (κείμενα JSONB ανά γλώσσα, φωτογραφίες Cloudinary)
--   · place_locations — περιορισμός μέρους σε τοποθεσίες παραλαβής (όταν allLocations = false)
--   · reviews         — ΜΟΝΟ οι κριτικές που προσθέτει χειροκίνητα η εταιρία
--   · pickup_locations."googlePlaceId" — για τις κριτικές Google (Places API, ΔΕΝ αποθηκεύονται)
-- Κάθε νέος πίνακας έχει tenantId (FK tenants, CASCADE). Μόνο προσθήκες·
-- η παλιά έκδοση δουλεύει κανονικά μαζί του.
-- Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.

BEGIN;

-- ── Μέρη ──
CREATE TABLE IF NOT EXISTS "places" (
  "id"              TEXT         NOT NULL,
  "tenantId"        TEXT         NOT NULL,
  "slug"            TEXT         NOT NULL,
  "nameI18n"        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "shortI18n"       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "descriptionI18n" JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "detailsI18n"     JSONB        NOT NULL DEFAULT '[]'::jsonb,
  "mapUrl"          TEXT,
  "coverImage"      TEXT,
  "photos"          JSONB        NOT NULL DEFAULT '[]'::jsonb,
  "allLocations"    BOOLEAN      NOT NULL DEFAULT true,
  "isActive"        BOOLEAN      NOT NULL DEFAULT true,
  "sortOrder"       INTEGER      NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "places_tenantId_slug_key" ON "places" ("tenantId", "slug");
CREATE INDEX IF NOT EXISTS "places_tenantId_idx" ON "places" ("tenantId");

CREATE TABLE IF NOT EXISTS "place_locations" (
  "placeId"          TEXT NOT NULL,
  "pickupLocationId" TEXT NOT NULL,
  CONSTRAINT "place_locations_pkey" PRIMARY KEY ("placeId", "pickupLocationId")
);
CREATE INDEX IF NOT EXISTS "place_locations_pickupLocationId_idx" ON "place_locations" ("pickupLocationId");

-- ── Κριτικές (χειροκίνητες) ──
CREATE TABLE IF NOT EXISTS "reviews" (
  "id"               TEXT         NOT NULL,
  "tenantId"         TEXT         NOT NULL,
  "pickupLocationId" TEXT,
  "authorName"       TEXT         NOT NULL,
  "rating"           INTEGER      NOT NULL,
  "text"             JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "reviewDate"       DATE         NOT NULL DEFAULT CURRENT_DATE,
  "sourceUrl"        TEXT,
  "isActive"         BOOLEAN      NOT NULL DEFAULT true,
  "sortOrder"        INTEGER      NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "reviews_tenantId_idx" ON "reviews" ("tenantId");

-- ── Google Place ID ανά τοποθεσία ──
ALTER TABLE "pickup_locations" ADD COLUMN IF NOT EXISTS "googlePlaceId" TEXT;

-- ── Κλειδιά και έλεγχοι ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'places_tenantId_fkey') THEN
    ALTER TABLE "places" ADD CONSTRAINT "places_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_locations_placeId_fkey') THEN
    ALTER TABLE "place_locations" ADD CONSTRAINT "place_locations_placeId_fkey"
      FOREIGN KEY ("placeId") REFERENCES "places" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_locations_pickupLocationId_fkey') THEN
    ALTER TABLE "place_locations" ADD CONSTRAINT "place_locations_pickupLocationId_fkey"
      FOREIGN KEY ("pickupLocationId") REFERENCES "pickup_locations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_tenantId_fkey') THEN
    ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_pickupLocationId_fkey') THEN
    ALTER TABLE "reviews" ADD CONSTRAINT "reviews_pickupLocationId_fkey"
      FOREIGN KEY ("pickupLocationId") REFERENCES "pickup_locations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_rating_check') THEN
    ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'places_photos_array_check') THEN
    ALTER TABLE "places" ADD CONSTRAINT "places_photos_array_check" CHECK (jsonb_typeof("photos") = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'places_details_array_check') THEN
    ALTER TABLE "places" ADD CONSTRAINT "places_details_array_check" CHECK (jsonb_typeof("detailsI18n") = 'array');
  END IF;
END $$;

COMMIT;

-- Verification — αναμενόμενο: new_tables = 3 · place_slug_unique = 1 · foreign_keys = 5 · checks = 3 · google_place_id = 1
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name IN ('places', 'place_locations', 'reviews')) AS new_tables,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'places_tenantId_slug_key') AS place_slug_unique,
  (SELECT count(*) FROM pg_constraint WHERE conname IN (
    'places_tenantId_fkey', 'place_locations_placeId_fkey', 'place_locations_pickupLocationId_fkey',
    'reviews_tenantId_fkey', 'reviews_pickupLocationId_fkey')) AS foreign_keys,
  (SELECT count(*) FROM pg_constraint WHERE conname IN (
    'reviews_rating_check', 'places_photos_array_check', 'places_details_array_check')) AS checks,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'pickup_locations' AND column_name = 'googlePlaceId') AS google_place_id;
