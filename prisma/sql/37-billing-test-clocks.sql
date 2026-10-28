-- prisma/sql/37-billing-test-clocks.sql
-- Συνδρομές: test clocks (ΜΟΝΟ Preview) + ένδειξη «πλήρης χρέωση ιδρυτή».
--
-- · tenants."stripeTestClockId" (NULL): το test clock του Stripe στο οποίο
--   είναι δεμένος ο πελάτης Stripe της εταιρίας. Γράφεται ΜΟΝΟ όταν ισχύουν
--   STRIPE_BILLING_TEST_CLOCKS=1 + κλειδί sk_test_ + VERCEL_ENV=preview.
--   Στο production μένει πάντα NULL.
-- · tenants."billingClockAt" (NULL): η ώρα (frozen_time) του clock, από το
--   event test_helpers.test_clock.ready. Με αυτήν μετρούν λήξη δοκιμής, χάρη
--   7 ημερών και ειδοποίηση 30 ημερών — μόνο όταν το clock είναι ενεργό.
-- · founder_full_charges: τιμολόγια ιδρυτή που πληρώθηκαν ΧΩΡΙΣ έκπτωση ενώ
--   απέμεναν μήνες (για τον Super Admin). Καμία αυτόματη επιστροφή χρημάτων.
--
-- Μόνο προσθήκες (nullable / νέος πίνακας)· η σημερινή έκδοση δουλεύει
-- κανονικά μαζί του. Idempotent. Τρέχει ΠΡΙΝ το preview αυτής της έκδοσης.

BEGIN;

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripeTestClockId" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billingClockAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "tenants_stripeTestClockId_idx" ON "tenants" ("stripeTestClockId");

CREATE TABLE IF NOT EXISTS "founder_full_charges" (
  "stripeInvoiceId" TEXT PRIMARY KEY,
  "tenantId"        TEXT NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "amountCents"     INTEGER NOT NULL,
  "billingReason"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "founder_full_charges_amount" CHECK ("amountCents" > 0)
);
CREATE INDEX IF NOT EXISTS "founder_full_charges_tenantId_idx" ON "founder_full_charges" ("tenantId");

COMMIT;

-- Verification — αναμενόμενο: tenant_columns = 2 · clock_index = 1 · full_charges_table = 1 · clocks_set = 0
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name IN ('stripeTestClockId', 'billingClockAt')) AS tenant_columns,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'tenants_stripeTestClockId_idx') AS clock_index,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'founder_full_charges') AS full_charges_table,
  (SELECT count(*) FROM "tenants" WHERE "stripeTestClockId" IS NOT NULL) AS clocks_set;
