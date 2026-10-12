-- prisma/sql/20-plans-storefront.sql
-- Πακέτα (entitlements) + δημόσια σελίδα (storefront) ανά εταιρία.
--
-- · plans: key (PK), name, modules JSONB, limits JSONB, active.
--     modules: {"dashboard":true,"publicSite":false} — ό,τι λείπει = false.
--     limits:  {"maxUsers":1,"maxVehicles":null}     — null ή απόν = απεριόριστο.
--     Τα όρια αλλάζουν ΜΟΝΟ εδώ (UPDATE "plans" …), χωρίς deploy.
--     active = false: το πακέτο δεν προσφέρεται για νέες αναθέσεις· όσες
--     εταιρίες το έχουν ήδη το κρατούν κανονικά.
-- · tenants."planKey" → plans."key" (ON DELETE SET NULL). Χωρίς πακέτο = καμία
--   ενότητα και κανένας νέος χρήστης/όχημα (ασφαλής προεπιλογή).
-- · tenants."entitlementOverrides" JSONB: {"modules":{…},"limits":{…}} για
--   ειδικές περιπτώσεις μίας εταιρίας· υπερισχύει του πακέτου ανά κλειδί
--   (και "maxUsers": null = απεριόριστο για αυτήν μόνο).
-- · tenants."storefrontSlug" (UNIQUE, NULL μέχρι να οριστεί) — ΞΕΧΩΡΙΣΤΟ από
--   το υπάρχον tenants."slug", που είναι δεμένο με login/JWT/seed.
-- · tenants."storefrontEnabled" BOOLEAN DEFAULT false.
-- · tenants."storefrontSettings" JSONB: κείμενα ανά γλώσσα, γλώσσες, πληρωμή.
-- · vehicles."publicVisible" BOOLEAN DEFAULT true.
--
-- Οι υπάρχουσες εταιρίες (και η δοκιμαστική) παίρνουν «full»: τίποτα δεν αλλάζει.
-- Idempotent: τρέχει όσες φορές χρειαστεί.

CREATE TABLE IF NOT EXISTS "plans" (
  "key"       TEXT PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "modules"   JSONB NOT NULL DEFAULT '{}',
  "limits"    JSONB NOT NULL DEFAULT '{}',
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Αρχικά πακέτα — ΠΡΟΣΩΡΙΝΕΣ τιμές. ON CONFLICT DO NOTHING: αν τα έχεις ήδη
-- αλλάξει, το ξανατρέξιμο ΔΕΝ τα πατά.
INSERT INTO "plans" ("key", "name", "modules", "limits") VALUES
  ('dashboard',      'Dashboard',
     '{"dashboard":true,"publicSite":false}', '{"maxUsers":1,"maxVehicles":null}'),
  ('dashboard_site', 'Dashboard + Site',
     '{"dashboard":true,"publicSite":true}',  '{"maxUsers":null,"maxVehicles":null}'),
  ('full',           'Full',
     '{"dashboard":true,"publicSite":true}',  '{"maxUsers":null,"maxVehicles":null}')
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "planKey" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "entitlementOverrides" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "storefrontSlug" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "storefrontEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "storefrontSettings" JSONB NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_storefrontSlug_key" ON "tenants" ("storefrontSlug");
CREATE INDEX IF NOT EXISTS "tenants_planKey_idx" ON "tenants" ("planKey");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_planKey_fkey'
  ) THEN
    ALTER TABLE "tenants"
      ADD CONSTRAINT "tenants_planKey_fkey" FOREIGN KEY ("planKey")
      REFERENCES "plans" ("key") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: όλες οι εταιρίες χωρίς πακέτο → «full».
UPDATE "tenants" SET "planKey" = 'full' WHERE "planKey" IS NULL;

ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "publicVisible" BOOLEAN NOT NULL DEFAULT true;

-- Verification — αναμενόμενο:
--   plans_count = 3 · tenants_without_plan = 0 · tenants_not_full = 0
--   tenant_columns = 5 · slug_index = 1 · plan_fk = 1 · vehicle_column = 1
--   storefronts_enabled = 0
-- (tenants_not_full = 0 μόνο την πρώτη φορά· αν έχεις ήδη αλλάξει πακέτο σε
--  κάποια εταιρία, θα δείξει πόσες.)
SELECT
  (SELECT count(*) FROM "plans" WHERE "key" IN ('dashboard','dashboard_site','full')) AS plans_count,
  (SELECT count(*) FROM "tenants" WHERE "planKey" IS NULL) AS tenants_without_plan,
  (SELECT count(*) FROM "tenants" WHERE "planKey" <> 'full') AS tenants_not_full,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'tenants'
      AND column_name IN ('planKey','entitlementOverrides','storefrontSlug','storefrontEnabled','storefrontSettings')) AS tenant_columns,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'tenants_storefrontSlug_key') AS slug_index,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'tenants_planKey_fkey') AS plan_fk,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'publicVisible') AS vehicle_column,
  (SELECT count(*) FROM "tenants" WHERE "storefrontEnabled") AS storefronts_enabled;
