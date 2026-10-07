-- prisma/sql/15-contract-fuel-type.sql
-- Νέο συμβόλαιο: τύπος καυσίμου ανά συμβόλαιο (Βενζίνη/Πετρέλαιο/Ηλεκτρικό/Υβριδικό).
--
-- · contracts."fuelType"  "FuelType" NULL  χωρίς προεπιλογή (null = δεν επιλέχθηκε)
--
-- Το enum "FuelType" υπάρχει ήδη (01-schema, vehicles."fuel").
-- Οι τοποθεσίες παραλαβής/επιστροφής ΔΕΝ θέλουν στήλη: contracts."pickupLocation"
-- και "returnLocation" υπάρχουν ήδη (01-schema).
--
-- Idempotent: τρέχει όσες φορές χρειαστεί.

ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "fuelType" "FuelType";

-- Verification: αναμενόμενο  1 | 2
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'contracts' AND column_name = 'fuelType'
      AND udt_name = 'FuelType' AND is_nullable = 'YES') AS fuel_type_column,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'contracts'
      AND column_name IN ('pickupLocation', 'returnLocation')) AS location_columns;
