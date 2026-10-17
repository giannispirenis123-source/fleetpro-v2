-- prisma/sql/27-stripe-connect.sql
-- Online πληρωμές κρατήσεων του δημόσιου site με Stripe Connect (Express),
-- ανά εταιρία. Τα χρήματα πάνε ΑΠΕΥΘΕΙΑΣ στον λογαριασμό της εταιρίας
-- (direct charge)· η πλατφόρμα κρατά προαιρετική προμήθεια (platformFeeBps).
--   · tenants  + λογαριασμός Stripe (id + κατάσταση) και ρυθμίσεις πληρωμής
--   · bookings + τρόπος/κατάσταση πληρωμής και λήξη της αναμονής πληρωμής
--   · booking_payments — μία γραμμή ανά Checkout Session (ποσό, επιστροφές)
--   · stripe_events    — τα events που εφαρμόστηκαν (idempotency του webhook)
-- ΚΑΝΕΝΑ στοιχείο κάρτας: η κάρτα μπαίνει μόνο στη σελίδα του Stripe.
-- Μόνο προσθήκες, με προεπιλογές = σημερινή συμπεριφορά (πληρωμή στην
-- παραλαβή)· η παλιά έκδοση δουλεύει κανονικά μαζί του.
-- Idempotent. Τρέχει στο Supabase SQL Editor ΠΡΙΝ από τη δοκιμή στο preview.

BEGIN;

-- ── Εταιρία: λογαριασμός Stripe Connect + ρυθμίσεις ──
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripeAccountId"        TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripeChargesEnabled"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripePayoutsEnabled"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "paymentOptions"         TEXT    NOT NULL DEFAULT 'PICKUP_ONLY';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "onlineAmountType"       TEXT    NOT NULL DEFAULT 'FULL';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "depositPercent"         INTEGER NOT NULL DEFAULT 30;
-- Προμήθεια πλατφόρμας σε basis points (100 = 1%). ΜΟΝΟ ο Super Admin.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "platformFeeBps"         INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_stripeAccountId_key" ON "tenants" ("stripeAccountId");

-- ── Κράτηση: πληρωμή ──
-- paymentMethod: NULL (dashboard / παλιές) | PICKUP | ONLINE
-- paymentStatus: NONE | AWAITING_PAYMENT | PAID | FAILED | EXPIRED | REFUNDED | PARTIALLY_REFUNDED
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "paymentMethod"    TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "paymentStatus"    TEXT NOT NULL DEFAULT 'NONE';
-- Ως πότε η AWAITING_PAYMENT κρατά το όχημα (= λήξη της Checkout Session).
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "paymentExpiresAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "bookings_tenantId_paymentStatus_idx" ON "bookings" ("tenantId", "paymentStatus");

-- ── Πληρωμές (μία ανά Checkout Session) ──
CREATE TABLE IF NOT EXISTS "booking_payments" (
  "id"                      TEXT         NOT NULL,
  "tenantId"                TEXT         NOT NULL,
  "bookingId"               TEXT         NOT NULL,
  "stripeAccountId"         TEXT         NOT NULL,
  "stripeCheckoutSessionId" TEXT         NOT NULL,
  "stripePaymentIntentId"   TEXT,
  "checkoutUrl"             TEXT,
  "amountCents"             INTEGER      NOT NULL,
  "refundedCents"           INTEGER      NOT NULL DEFAULT 0,
  "applicationFeeCents"     INTEGER      NOT NULL DEFAULT 0,
  "currency"                TEXT         NOT NULL DEFAULT 'eur',
  -- OPEN | PAID | FAILED | EXPIRED | REFUNDED | PARTIALLY_REFUNDED
  "status"                  TEXT         NOT NULL DEFAULT 'OPEN',
  -- Ιστορικό επιστροφών: [{ id, amountCents, at, userId }]
  "refunds"                 JSONB        NOT NULL DEFAULT '[]'::jsonb,
  "expiresAt"               TIMESTAMP(3),
  "paidAt"                  TIMESTAMP(3),
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "booking_payments_stripeCheckoutSessionId_key" ON "booking_payments" ("stripeCheckoutSessionId");
CREATE INDEX IF NOT EXISTS "booking_payments_tenantId_bookingId_idx" ON "booking_payments" ("tenantId", "bookingId");
CREATE INDEX IF NOT EXISTS "booking_payments_stripePaymentIntentId_idx" ON "booking_payments" ("stripePaymentIntentId");

-- ── Events του webhook που εφαρμόστηκαν (το ίδιο event ΠΟΤΕ δύο φορές) ──
CREATE TABLE IF NOT EXISTS "stripe_events" (
  "id"         TEXT         NOT NULL,
  "type"       TEXT         NOT NULL,
  "account"    TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- ── Κλειδιά και έλεγχοι ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_paymentOptions_check') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_paymentOptions_check"
      CHECK ("paymentOptions" IN ('PICKUP_ONLY', 'ONLINE_OR_PICKUP', 'ONLINE_ONLY'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_onlineAmountType_check') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_onlineAmountType_check"
      CHECK ("onlineAmountType" IN ('FULL', 'DEPOSIT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_depositPercent_check') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_depositPercent_check"
      CHECK ("depositPercent" BETWEEN 1 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_platformFeeBps_check') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_platformFeeBps_check"
      CHECK ("platformFeeBps" BETWEEN 0 AND 5000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_paymentMethod_check') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_paymentMethod_check"
      CHECK ("paymentMethod" IS NULL OR "paymentMethod" IN ('PICKUP', 'ONLINE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_paymentStatus_check') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_paymentStatus_check"
      CHECK ("paymentStatus" IN ('NONE', 'AWAITING_PAYMENT', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_payments_tenantId_fkey') THEN
    ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_payments_bookingId_fkey') THEN
    ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "bookings" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_payments_status_check') THEN
    ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_status_check"
      CHECK ("status" IN ('OPEN', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_payments_amounts_check') THEN
    ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_amounts_check"
      CHECK ("amountCents" > 0 AND "refundedCents" >= 0 AND "refundedCents" <= "amountCents" AND "applicationFeeCents" >= 0);
  END IF;
END $$;

COMMIT;

-- ── Επαλήθευση (αναμενόμενο: 8 | 3 | 2 | 10 | 0) ──
--   νέες στήλες tenants | νέες στήλες bookings | νέοι πίνακες | constraints | κρατήσεις με άκυρη κατάσταση πληρωμής
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'tenants' AND column_name IN
       ('stripeAccountId','stripeChargesEnabled','stripePayoutsEnabled','stripeDetailsSubmitted',
        'paymentOptions','onlineAmountType','depositPercent','platformFeeBps')) AS tenant_columns,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'bookings' AND column_name IN ('paymentMethod','paymentStatus','paymentExpiresAt')) AS booking_columns,
  (SELECT count(*) FROM information_schema.tables
     WHERE table_name IN ('booking_payments','stripe_events')) AS new_tables,
  (SELECT count(*) FROM pg_constraint WHERE conname IN
     ('tenants_paymentOptions_check','tenants_onlineAmountType_check','tenants_depositPercent_check',
      'tenants_platformFeeBps_check','bookings_paymentMethod_check','bookings_paymentStatus_check',
      'booking_payments_tenantId_fkey','booking_payments_bookingId_fkey','booking_payments_status_check',
      'booking_payments_amounts_check')) AS constraints,
  (SELECT count(*) FROM "bookings" WHERE "paymentStatus" <> 'NONE') AS non_default_payments;
