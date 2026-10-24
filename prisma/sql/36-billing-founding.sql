-- prisma/sql/36-billing-founding.sql
-- Συνδρομές εταιριών (Stripe Billing, test mode) + πρόγραμμα «Πρώτες 10 εταιρίες».
--
-- · plans (ο ΥΠΑΡΧΩΝ πίνακας πακέτων, SQL 20): + τιμές (cents, χωρίς ΦΠΑ) και
--   σειρά εμφάνισης· τρία νέα πλάνα starter / pro / business. Τα όρια ζουν
--   ΜΟΝΟ εδώ ("limits"."maxVehicles") και αλλάζουν με UPDATE, χωρίς deploy.
--   Τα dashboard / dashboard_site / full ΔΕΝ αλλάζουν (μένουν για τις
--   υπάρχουσες εταιρίες και τον Super Admin).
-- · tenants: κατάσταση συνδρομής ("billingStatus"). Προεπιλογή 'exempt' =
--   εκτός χρέωσης: ΟΛΕΣ οι υπάρχουσες εταιρίες (και όσες φτιάχνει ο Super
--   Admin) δουλεύουν ακριβώς όπως πριν. Μόνο οι νέες από /signup μπαίνουν
--   σε δοκιμή/συνδρομή.
-- · founding_program: ΜΙΑ γραμμή, σταθερό μέγιστο 10 (CHECK) και μετρητής που
--   ανεβαίνει ατομικά μέσα στη transaction της εγγραφής.
-- · founder_codes: κωδικοί ιδρυτή (ΜΟΝΟ sha256 hash, ποτέ ο κωδικός).
-- · founder_claims: ποια εταιρία πήρε ποια θέση (slotNumber 1–10, UNIQUE) —
--   δεύτερο δίχτυ ασφαλείας: ούτε με ταυτόχρονες εγγραφές δεν περνά το 10.
-- · founder_invoices: τα τιμολόγια του Stripe με την έκπτωση 50% (μέτρηση
--   των 12 πληρωμένων μηνών).
-- · tenant_feedback: η προαιρετική φόρμα «Πες μας τη γνώμη σου».
--
-- Μόνο προσθήκες· η σημερινή έκδοση δουλεύει κανονικά μαζί του.
-- Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.

BEGIN;

-- 1) Πλάνα: τιμές + νέα πλάνα.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "priceMonthlyCents" INTEGER;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "priceYearlyCents" INTEGER;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Ετήσια = 10 μηνιαίες (2 μήνες δώρο). ON CONFLICT DO NOTHING: αν τα έχεις
-- ήδη αλλάξει, το ξανατρέξιμο ΔΕΝ τα πατά.
INSERT INTO "plans" ("key", "name", "modules", "limits", "priceMonthlyCents", "priceYearlyCents", "sortOrder") VALUES
  ('starter',  'Starter',
     '{"dashboard":true,"publicSite":true,"multiStore":false}', '{"maxUsers":null,"maxVehicles":15}',   3900,  39000, 10),
  ('pro',      'Pro',
     '{"dashboard":true,"publicSite":true,"multiStore":false}', '{"maxUsers":null,"maxVehicles":50}',   7900,  79000, 20),
  ('business', 'Business',
     '{"dashboard":true,"publicSite":true,"multiStore":true}',  '{"maxUsers":null,"maxVehicles":null}', 14900, 149000, 30)
ON CONFLICT ("key") DO NOTHING;

-- 2) Συνδρομή στην εταιρία.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billingStatus" TEXT NOT NULL DEFAULT 'exempt';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billingInterval" TEXT NOT NULL DEFAULT 'month';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trialStartedAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "pastDueSince" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "founderDiscountEndsAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "founderNoticeSentAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_billingStatus_check') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_billingStatus_check" CHECK ("billingStatus" IN (
      'exempt', 'founder_trial', 'awaiting_checkout',
      'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_billingInterval_check') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_billingInterval_check" CHECK ("billingInterval" IN ('month', 'year'));
  END IF;
END $$;

-- Ένας πελάτης / μία συνδρομή Stripe ανά εταιρία. Μόνο αν δεν υπάρχουν ήδη
-- διπλότυπα (σήμερα οι στήλες είναι κενές)· αλλιώς NOTICE, χωρίς αποτυχία.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'tenants_stripeCustomerId_key') THEN
    IF EXISTS (SELECT "stripeCustomerId" FROM "tenants" WHERE "stripeCustomerId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1) THEN
      RAISE NOTICE 'Διπλότυπα stripeCustomerId — το UNIQUE δεν μπήκε';
    ELSE
      CREATE UNIQUE INDEX "tenants_stripeCustomerId_key" ON "tenants" ("stripeCustomerId");
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'tenants_stripeSubId_key') THEN
    IF EXISTS (SELECT "stripeSubId" FROM "tenants" WHERE "stripeSubId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1) THEN
      RAISE NOTICE 'Διπλότυπα stripeSubId — το UNIQUE δεν μπήκε';
    ELSE
      CREATE UNIQUE INDEX "tenants_stripeSubId_key" ON "tenants" ("stripeSubId");
    END IF;
  END IF;
END $$;

-- 3) Πρόγραμμα πρώτων εταιριών: ΜΙΑ γραμμή, μέγιστο 10.
CREATE TABLE IF NOT EXISTS "founding_program" (
  "id"           TEXT PRIMARY KEY DEFAULT 'founding',
  "maxSlots"     INTEGER NOT NULL DEFAULT 10,
  "claimedCount" INTEGER NOT NULL DEFAULT 0,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "founding_program_single" CHECK ("id" = 'founding'),
  CONSTRAINT "founding_program_max10" CHECK ("maxSlots" = 10),
  CONSTRAINT "founding_program_claimed" CHECK ("claimedCount" >= 0 AND "claimedCount" <= "maxSlots")
);
INSERT INTO "founding_program" ("id") VALUES ('founding') ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "founder_codes" (
  "id"           TEXT PRIMARY KEY,
  "codeHash"     TEXT NOT NULL,
  "label"        TEXT,
  "maxClaims"    INTEGER NOT NULL DEFAULT 1,
  "claimedCount" INTEGER NOT NULL DEFAULT 0,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "expiresAt"    TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "founder_codes_max" CHECK ("maxClaims" BETWEEN 1 AND 10),
  CONSTRAINT "founder_codes_claimed" CHECK ("claimedCount" >= 0 AND "claimedCount" <= "maxClaims")
);
CREATE UNIQUE INDEX IF NOT EXISTS "founder_codes_codeHash_key" ON "founder_codes" ("codeHash");

-- tenantId ON DELETE SET NULL: η θέση ΜΕΝΕΙ πιασμένη αν σβηστεί η εταιρία
-- (ο μετρητής και οι διεκδικήσεις συμφωνούν πάντα).
CREATE TABLE IF NOT EXISTS "founder_claims" (
  "id"         TEXT PRIMARY KEY,
  "codeId"     TEXT NOT NULL REFERENCES "founder_codes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tenantId"   TEXT REFERENCES "tenants" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "slotNumber" INTEGER NOT NULL,
  "claimedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "founder_claims_slot" CHECK ("slotNumber" BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX IF NOT EXISTS "founder_claims_slotNumber_key" ON "founder_claims" ("slotNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "founder_claims_tenantId_key" ON "founder_claims" ("tenantId");
CREATE INDEX IF NOT EXISTS "founder_claims_codeId_idx" ON "founder_claims" ("codeId");

-- 4) Τιμολόγια με την έκπτωση ιδρυτή (μέτρηση 12 πληρωμένων μηνών).
CREATE TABLE IF NOT EXISTS "founder_invoices" (
  "stripeInvoiceId" TEXT PRIMARY KEY,
  "tenantId"        TEXT NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "months"          INTEGER NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'open',
  "periodEnd"       TIMESTAMP(3),
  "paidAt"          TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "founder_invoices_months" CHECK ("months" IN (1, 12)),
  CONSTRAINT "founder_invoices_status" CHECK ("status" IN ('open', 'paid', 'void'))
);
CREATE INDEX IF NOT EXISTS "founder_invoices_tenantId_idx" ON "founder_invoices" ("tenantId");

-- 5) «Πες μας τη γνώμη σου» (προαιρετικό).
CREATE TABLE IF NOT EXISTS "tenant_feedback" (
  "id"           TEXT PRIMARY KEY,
  "tenantId"     TEXT NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId"       TEXT REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "helpedMost"   TEXT,
  "missing"      TEXT,
  "vehicleCount" INTEGER,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_feedback_vehicles" CHECK ("vehicleCount" IS NULL OR ("vehicleCount" >= 0 AND "vehicleCount" <= 100000))
);
CREATE INDEX IF NOT EXISTS "tenant_feedback_createdAt_idx" ON "tenant_feedback" ("createdAt");
CREATE INDEX IF NOT EXISTS "tenant_feedback_tenantId_idx" ON "tenant_feedback" ("tenantId");

COMMIT;

-- Verification — αναμενόμενο:
--   new_plans = 3 · plan_prices = 3 · tenant_columns = 8 · billing_checks = 2
--   exempt_tenants = όλες οι εταιρίες (= total_tenants) · founding = 10|0
--   new_tables = 5 · stripe_unique = 2
SELECT
  (SELECT count(*) FROM "plans" WHERE "key" IN ('starter', 'pro', 'business')) AS new_plans,
  (SELECT count(*) FROM "plans" WHERE "key" IN ('starter', 'pro', 'business')
      AND "priceYearlyCents" = "priceMonthlyCents" * 10) AS plan_prices,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tenants' AND column_name IN (
      'billingStatus', 'billingInterval', 'trialStartedAt', 'pastDueSince', 'currentPeriodEnd',
      'cancelAtPeriodEnd', 'founderDiscountEndsAt', 'founderNoticeSentAt')) AS tenant_columns,
  (SELECT count(*) FROM pg_constraint
    WHERE conname IN ('tenants_billingStatus_check', 'tenants_billingInterval_check')) AS billing_checks,
  (SELECT count(*) FROM "tenants" WHERE "billingStatus" = 'exempt') AS exempt_tenants,
  (SELECT count(*) FROM "tenants") AS total_tenants,
  (SELECT "maxSlots" || '|' || "claimedCount" FROM "founding_program" WHERE "id" = 'founding') AS founding,
  (SELECT count(*) FROM information_schema.tables WHERE table_name IN (
      'founding_program', 'founder_codes', 'founder_claims', 'founder_invoices', 'tenant_feedback')) AS new_tables,
  (SELECT count(*) FROM pg_indexes
    WHERE indexname IN ('tenants_stripeCustomerId_key', 'tenants_stripeSubId_key')) AS stripe_unique;
