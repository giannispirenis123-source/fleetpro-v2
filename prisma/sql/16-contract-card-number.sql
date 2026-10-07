-- prisma/sql/16-contract-card-number.sql
-- Πλήρης αριθμός κάρτας, ΚΡΥΠΤΟΓΡΑΦΗΜΕΝΟΣ (AES-256-GCM στον server, κλειδί
-- CARD_ENCRYPTION_KEY στο Vercel). Ποτέ σε καθαρή μορφή στη βάση, ποτέ CVV.
--
-- · contracts."cardNumberEnc"  TEXT NULL  JSON { payment?, deposit? } με
--   ξεχωριστά κρυπτογραφημένη τιμή ανά κάρτα (βλ. src/lib/cardCrypto.ts).
--
-- Οι στήλες "paymentCard"/"depositCard" (μάρκα, 4 τελευταία, κάτοχος, λήξη)
-- μένουν ως έχουν· τα 4 τελευταία συμπληρώνονται από τον πλήρη αριθμό.
--
-- Idempotent: τρέχει όσες φορές χρειαστεί. Προϋπόθεση: έχει τρέξει το 15.

ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "cardNumberEnc" TEXT;

-- Verification: αναμενόμενο  1 | 1
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'contracts' AND column_name = 'cardNumberEnc'
      AND data_type = 'text' AND is_nullable = 'YES') AS card_number_column,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'contracts' AND column_name = 'fuelType') AS sql15_fuel_type;
