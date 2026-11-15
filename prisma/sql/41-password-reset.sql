-- prisma/sql/41-password-reset.sql
-- «Ξέχασα τον κωδικό μου» + ακύρωση συνδέσεων μετά από αλλαγή κωδικού.
--   · users."passwordChangedAt": NULLABLE. Κάθε σύνδεση (JWT) που εκδόθηκε ΠΡΙΝ
--     από αυτή τη στιγμή απορρίπτεται. NULL = καμία αλλαγή → οι σημερινές
--     συνδέσεις ΜΕΝΟΥΝ ως έχουν (κανείς δεν αποσυνδέεται από αυτό το SQL).
--   · password_reset_tokens: tokens επαναφοράς — στη βάση ΜΟΝΟ το sha256 hash,
--     λήξη, μίας χρήσης (usedAt). FK → users ON DELETE CASCADE.
-- Μόνο προσθήκη· ΚΑΜΙΑ υπάρχουσα γραμμή δεν αλλάζει. Idempotent (ξανά → καμία
-- αλλαγή). Τρέχει στο Supabase SQL Editor ΠΡΙΝ από το merge ΚΑΙ πριν από το
-- preview (ο νέος κώδικας διαβάζει τη στήλη σε ΚΑΘΕ αίτημα).

BEGIN;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id"        TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "tokenHash" TEXT         NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_tokenHash_key" ON "password_reset_tokens" ("tokenHash");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_userId_idx" ON "password_reset_tokens" ("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'password_reset_tokens_userId_fkey') THEN
    ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;

-- Verification — αναμενόμενο:
-- column_nullable = YES · table_exists = 1 · unique_hash = 1 · user_index = 1 ·
-- fk_cascade = 1 · users_with_stamp = 0 · tokens = 0
SELECT
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'passwordChangedAt') AS column_nullable,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name = 'password_reset_tokens') AS table_exists,
  (SELECT count(*) FROM pg_indexes
    WHERE tablename = 'password_reset_tokens' AND indexname = 'password_reset_tokens_tokenHash_key') AS unique_hash,
  (SELECT count(*) FROM pg_indexes
    WHERE tablename = 'password_reset_tokens' AND indexname = 'password_reset_tokens_userId_idx') AS user_index,
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'password_reset_tokens_userId_fkey' AND confdeltype = 'c') AS fk_cascade,
  (SELECT count(*) FROM "users" WHERE "passwordChangedAt" IS NOT NULL) AS users_with_stamp,
  (SELECT count(*) FROM "password_reset_tokens") AS tokens;
