-- prisma/sql/18-vehicle-photos.sql
-- Φωτογραφίες οχήματος (Cloudinary) — Στόλος.
--
-- · vehicles."photos"  JSONB NOT NULL DEFAULT '[]'
--     [{ "id", "url", "publicId", "order" }] — έως 10, η πρώτη (order 0) είναι η κύρια.
--     Φάκελος Cloudinary: fleetpro/{companyId}/vehicles/{vehicleId}
-- · Η παλιά στήλη vehicles."images" (TEXT[], μόνο URLs, χωρίς publicId/σειρά)
--   ΔΕΝ σβήνεται. Ό,τι URL έχει μεταφέρεται ΜΙΑ φορά στο "photos" (μόνο σε
--   οχήματα με κενό "photos")· το publicId βγαίνει από URL του Cloudinary.
--
-- Idempotent: τρέχει όσες φορές χρειαστεί.

ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "photos" JSONB NOT NULL DEFAULT '[]';

-- Μεταφορά images → photos (το πολύ 10, με τη σειρά τους).
UPDATE "vehicles" v
SET "photos" = (
  SELECT jsonb_agg(
           jsonb_build_object(
             'id', substr(md5(t.u || v."id"), 1, 16),
             'url', t.u,
             'publicId', CASE
               WHEN t.u ~ '^https://res\.cloudinary\.com/[^/]+/image/upload/'
               THEN regexp_replace(
                      regexp_replace(t.u, '^https://res\.cloudinary\.com/[^/]+/image/upload/(v[0-9]+/)?', ''),
                      '\.[A-Za-z0-9]+$', '')
               ELSE NULL
             END,
             'order', t.n - 1
           ) ORDER BY t.n)
  FROM (
    SELECT u, row_number() OVER (ORDER BY o) AS n
    FROM unnest(v."images") WITH ORDINALITY AS x(u, o)
    WHERE u ~ '^https://'
  ) t
  WHERE t.n <= 10
)
WHERE v."photos" = '[]'::jsonb
  AND EXISTS (SELECT 1 FROM unnest(v."images") AS y(u) WHERE u ~ '^https://');

-- Verification: αναμενόμενο  1 | (οχήματα με φωτογραφίες) | 0
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'photos') AS photos_column,
  (SELECT count(*) FROM "vehicles" WHERE jsonb_array_length("photos") > 0) AS vehicles_with_photos,
  (SELECT count(*) FROM "vehicles"
    WHERE "photos" = '[]'::jsonb
      AND EXISTS (SELECT 1 FROM unnest("images") AS y(u) WHERE u ~ '^https://')) AS images_not_migrated;
