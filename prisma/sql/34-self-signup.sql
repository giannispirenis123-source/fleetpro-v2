-- prisma/sql/34-self-signup.sql
-- Αυτόματη εγγραφή εταιρίας (self-serve signup) + onboarding.
--   · users."emailVerifiedAt" — πότε επαληθεύτηκε το email. ΠΡΟΕΠΙΛΟΓΗ now():
--     κάθε χρήστης που φτιάχνεται με τους ΥΠΑΡΧΟΝΤΕΣ τρόπους (Super Admin,
--     «Χρήστες» της εταιρίας, seed) είναι αμέσως επαληθευμένος. ΜΟΝΟ η εγγραφή
--     (/signup) γράφει ρητά NULL μέχρι να πατηθεί ο σύνδεσμος του email.
--     BACKFILL: όλοι οι υπάρχοντες χρήστες (και της δοκιμαστικής/demo
--     εταιρίας) = επαληθευμένοι τώρα, ώστε να μην κλειδωθεί κανείς έξω.
--     Γίνεται ΜΟΝΟ τη στιγμή που προστίθεται η στήλη: σε 2η εκτέλεση δεν
--     «επαληθεύει» ποτέ λογαριασμούς που περιμένουν επαλήθευση.
--   · "email_verification_tokens" — μόνο το HASH (sha256) του συνδέσμου,
--     λήξη σε 24 ώρες, μίας χρήσης (usedAt).
--   · tenants."signupSource" 'manual' | 'self_signup' (προεπιλογή 'manual').
--   · tenants."onboardingState" JSONB — πρόοδος του onboarding (NULL = καμία
--     λίστα, όπως όλες οι μέχρι τώρα εταιρίες).
--   · tenants."cleanupFlaggedAt" — σήμανση από τον Super Admin για καθάρισμα
--     (ανεπιβεβαίωτη εγγραφή > 7 ημέρες). ΚΑΜΙΑ αυτόματη διαγραφή.
-- Μόνο προσθήκες· η σημερινή έκδοση δουλεύει κανονικά μαζί του.
-- Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.

BEGIN;

-- 1) users.emailVerifiedAt + backfill ΜΟΝΟ στην πρώτη εκτέλεση.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'emailVerifiedAt'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
    -- Το ADD COLUMN με DEFAULT γεμίζει ήδη τις υπάρχουσες γραμμές· ρητά, για σιγουριά.
    UPDATE "users" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "emailVerifiedAt" IS NULL;
  END IF;
END $$;
-- (Αν η στήλη υπήρχε ήδη από παλιότερη δοκιμή χωρίς default.)
ALTER TABLE "users" ALTER COLUMN "emailVerifiedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- 2) Tokens επαλήθευσης email.
CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
  "id"        TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "tokenHash" TEXT         NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_verification_tokens_tokenHash_key" ON "email_verification_tokens" ("tokenHash");
CREATE INDEX IF NOT EXISTS "email_verification_tokens_userId_idx" ON "email_verification_tokens" ("userId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_verification_tokens_userId_fkey') THEN
    ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) Προέλευση εταιρίας, πρόοδος onboarding, σήμανση καθαρίσματος.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "signupSource" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "onboardingState" JSONB;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "cleanupFlaggedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "tenants_signupSource_createdAt_idx" ON "tenants" ("signupSource", "createdAt");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_signupSource_check') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_signupSource_check"
      CHECK ("signupSource" IN ('manual', 'self_signup'));
  END IF;
END $$;

COMMIT;

-- Verification — αναμενόμενο (αμέσως μετά την 1η εκτέλεση, πριν από οποιαδήποτε εγγραφή):
--   user_column = 1 · token_table = 1 · token_indexes = 2 · tenant_columns = 3 · source_check = 1
--   · unverified_users = 0 · self_signup_tenants = 0
-- (unverified_users = 0 σημαίνει ότι ΚΑΝΕΝΑΣ υπάρχων χρήστης δεν κλειδώνεται έξω.)
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'emailVerifiedAt') AS user_column,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name = 'email_verification_tokens') AS token_table,
  (SELECT count(*) FROM pg_indexes WHERE indexname IN (
    'email_verification_tokens_tokenHash_key', 'email_verification_tokens_userId_idx')) AS token_indexes,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name IN ('signupSource', 'onboardingState', 'cleanupFlaggedAt')) AS tenant_columns,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'tenants_signupSource_check') AS source_check,
  (SELECT count(*) FROM "users" WHERE "emailVerifiedAt" IS NULL) AS unverified_users,
  (SELECT count(*) FROM "tenants" WHERE "signupSource" = 'self_signup') AS self_signup_tenants;
