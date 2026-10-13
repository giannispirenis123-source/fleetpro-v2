-- prisma/sql/21b-demo-public-settings.sql
-- ΠΡΟΑΙΡΕΤΙΚΟ — ενδεικτικά δεδομένα δημόσιου site ΜΟΝΟ για τη δοκιμαστική
-- εταιρία. Τρέχει ΜΕΤΑ το 21. Idempotent (ON CONFLICT DO NOTHING / NOT EXISTS):
-- ό,τι έχεις ήδη αλλάξει από το dashboard ΔΕΝ πατιέται.
--
-- Η εταιρία βρίσκεται από το (εσωτερικό) slug της — άλλαξέ το εδώ αν χρειάζεται:
--   v_slug := 'p-rentals'
-- Ποσά: cents στους νέους πίνακες, € (Decimal) στα extras.
-- Τα ids είναι σταθερά (md5 του tenant + κλειδί), άρα το ξανατρέξιμο δεν διπλασιάζει.

BEGIN;

DO $$
DECLARE
  v_slug   TEXT := 'p-rentals';
  v_tenant TEXT;
  g        RECORD;
  s        RECORD;
  p        INTEGER;
BEGIN
  SELECT "id" INTO v_tenant FROM "tenants" WHERE "slug" = v_slug;
  IF v_tenant IS NULL THEN
    RAISE NOTICE 'Δεν βρέθηκε εταιρία με slug %, τίποτα δεν άλλαξε.', v_slug;
    RETURN;
  END IF;

  /* ── Τοποθεσίες ── */
  INSERT INTO "pickup_locations"
    ("id","tenantId","slug","name","type","address","askFlightNumber","askFerryName","askAddress",
     "adjustmentType","adjustmentValue","adjustmentLabel","afterHoursFeeCents","sortOrder")
  SELECT 'psd_' || left(md5(v_tenant || ':loc:' || x.slug), 20), v_tenant, x.slug, x.name::jsonb, x.type, x.address,
         x.type = 'airport', x.type = 'port', x.type IN ('hotel','other'),
         x.adj_type, x.adj_value, x.adj_label::jsonb, x.ah_fee, x.sort
  FROM (VALUES
    ('chania-airport',      '{"el":"Αεροδρόμιο Χανίων","en":"Chania Airport (CHQ)"}',                'airport', 'Αεροδρόμιο «Ιωάννης Δασκαλογιάννης»', 'none',    0,    '{}', NULL, 10),
    ('kato-daratso-office', '{"el":"Γραφείο Κάτω Δαράτσο","en":"Kato Daratso office"}',            'office',  'Κάτω Δαράτσο, Χανιά',                   'percent', -10,  '{"el":"Έκπτωση γραφείου 10%","en":"Office discount 10%"}', 0, 20),
    ('chania-center',       '{"el":"Κέντρο Χανίων","en":"Chania centre"}',                          'city',    'Χανιά',                                 'none',    0,    '{}', NULL, 30),
    ('chania-old-port',     '{"el":"Παλιό Λιμάνι Χανίων","en":"Chania Old Port"}',                  'city',    'Παλιό Λιμάνι, Χανιά',                   'none',    0,    '{}', NULL, 40),
    ('souda-port',          '{"el":"Λιμάνι Σούδας","en":"Souda Port"}',                             'port',    'Σούδα',                                 'none',    0,    '{}', NULL, 50),
    ('rethymno-port',       '{"el":"Λιμάνι Ρεθύμνου","en":"Rethymno Port"}',                        'port',    'Ρέθυμνο',                               'fixed',   2000, '{"el":"Παράδοση στο Ρέθυμνο","en":"Rethymno delivery"}', NULL, 60),
    ('heraklion-port',      '{"el":"Λιμάνι Ηρακλείου","en":"Heraklion Port"}',                      'port',    'Ηράκλειο',                              'fixed',   5000, '{"el":"Παράδοση στο Ηράκλειο","en":"Heraklion delivery"}', NULL, 70),
    ('heraklion-airport',   '{"el":"Αεροδρόμιο Ηρακλείου","en":"Heraklion Airport (HER)"}',        'airport', 'Αεροδρόμιο «Νίκος Καζαντζάκης»',        'fixed',   5000, '{"el":"Παράδοση στο Ηράκλειο","en":"Heraklion delivery"}', NULL, 80),
    ('hotel-other',         '{"el":"Ξενοδοχείο / Άλλο σημείο","en":"Hotel / Other address"}',       'hotel',   NULL,                                    'none',    0,    '{}', NULL, 90)
  ) AS x(slug, name, type, address, adj_type, adj_value, adj_label, ah_fee, sort)
  ON CONFLICT DO NOTHING;

  /* ── Ηλικίες οδηγού ── */
  INSERT INTO "driver_age_bands"
    ("id","tenantId","minAge","maxAge","label","explanation","allowed","isDefault","surchargeType","surchargeCents","surchargeMaxCents","sortOrder")
  SELECT 'psd_' || left(md5(v_tenant || ':age:' || x.min_age), 20), v_tenant, x.min_age, x.max_age, x.label::jsonb, x.expl::jsonb,
         true, x.is_default, x.sur_type, x.sur, x.sur_max, x.sort
  FROM (VALUES
    (21, 22, '{"el":"21–22 ετών","en":"21–22 years"}',
             '{"el":"Νέος οδηγός: επιβάρυνση 8 €/ημέρα (έως 56 €), δίπλωμα τουλάχιστον 1 έτους.","en":"Young driver: 8 €/day surcharge (max 56 €), licence held for at least 1 year."}',
             false, 'per_day', 800, 5600, 10),
    (23, 70, '{"el":"23–70 ετών","en":"23–70 years"}', '{}', true, 'none', 0, NULL, 20),
    (71, 75, '{"el":"71–75 ετών","en":"71–75 years"}',
             '{"el":"Οδηγός άνω των 70: επιβάρυνση 5 €/ημέρα (έως 35 €).","en":"Driver over 70: 5 €/day surcharge (max 35 €)."}',
             false, 'per_day', 500, 3500, 30)
  ) AS x(min_age, max_age, label, expl, is_default, sur_type, sur, sur_max, sort)
  WHERE NOT EXISTS (
    SELECT 1 FROM "driver_age_bands" b
    WHERE b."tenantId" = v_tenant AND b."minAge" <= x.max_age AND b."maxAge" >= x.min_age
  )
  ON CONFLICT DO NOTHING;

  /* ── Ομάδες (A–E Manual, B–D Automatic, A Cabrio) ── */
  INSERT INTO "rental_groups"
    ("id","tenantId","code","vehicleType","name","similarModels","seats","doors","transmission","fuel",
     "bagsLarge","bagsSmall","airCondition","minDriverAge","licenceCategory","basePriceCents","depositCents","excessCents","sortOrder")
  SELECT 'psd_' || left(md5(v_tenant || ':grp:' || x.code), 20), v_tenant, x.code, 'car', x.name::jsonb, x.similar_models::jsonb,
         x.seats, x.doors, x.trans, x.fuel::"FuelType", x.bl, x.bs, true, x.min_age, 'B', x.base, NULL, x.excess, x.sort
  FROM (VALUES
    ('A-MAN',   '{"el":"Κατηγορία A · Mini","en":"Group A · Mini"}',           '{"el":"Fiat Panda ή παρόμοιο","en":"Fiat Panda or similar"}',            4, 5, 'manual',    'PETROL', 0, 2, 21, 3000,  80000, 10),
    ('B-MAN',   '{"el":"Κατηγορία B · Οικονομικό","en":"Group B · Economy"}',  '{"el":"Toyota Yaris ή παρόμοιο","en":"Toyota Yaris or similar"}',        5, 5, 'manual',    'PETROL', 1, 1, 21, 3500,  80000, 20),
    ('C-MAN',   '{"el":"Κατηγορία C · Compact","en":"Group C · Compact"}',     '{"el":"VW Golf ή παρόμοιο","en":"VW Golf or similar"}',                  5, 5, 'manual',    'DIESEL', 2, 1, 23, 4200, 100000, 30),
    ('D-MAN',   '{"el":"Κατηγορία D · Οικογενειακό","en":"Group D · Family"}', '{"el":"Skoda Octavia ή παρόμοιο","en":"Skoda Octavia or similar"}',      5, 5, 'manual',    'DIESEL', 2, 2, 23, 5000, 100000, 40),
    ('E-MAN',   '{"el":"Κατηγορία E · SUV","en":"Group E · SUV"}',             '{"el":"Nissan Qashqai ή παρόμοιο","en":"Nissan Qashqai or similar"}',    5, 5, 'manual',    'DIESEL', 3, 2, 25, 6500, 120000, 50),
    ('B-AUT',   '{"el":"Κατηγορία B · Αυτόματο","en":"Group B · Automatic"}', '{"el":"Toyota Yaris Hybrid ή παρόμοιο","en":"Toyota Yaris Hybrid or similar"}', 5, 5, 'automatic', 'HYBRID', 1, 1, 21, 4500, 80000, 60),
    ('C-AUT',   '{"el":"Κατηγορία C · Αυτόματο","en":"Group C · Automatic"}', '{"el":"VW Golf DSG ή παρόμοιο","en":"VW Golf DSG or similar"}',          5, 5, 'automatic', 'PETROL', 2, 1, 23, 5200, 100000, 70),
    ('D-AUT',   '{"el":"Κατηγορία D · Αυτόματο","en":"Group D · Automatic"}', '{"el":"Toyota Corolla Hybrid ή παρόμοιο","en":"Toyota Corolla Hybrid or similar"}', 5, 5, 'automatic', 'HYBRID', 2, 2, 23, 6000, 100000, 80),
    ('A-CABRIO','{"el":"Κατηγορία A · Cabrio","en":"Group A · Convertible"}', '{"el":"Fiat 500C ή παρόμοιο","en":"Fiat 500C or similar"}',              4, 3, 'manual',    'PETROL', 0, 2, 23, 5500, 100000, 90)
  ) AS x(code, name, similar_models, seats, doors, trans, fuel, bl, bs, min_age, base, excess, sort)
  ON CONFLICT DO NOTHING;

  /* ── Σεζόν (χωρίς κενά: η Υψηλή κερδίζει τη Μέση με priority) ── */
  INSERT INTO "seasons" ("id","tenantId","name","startMonthDay","endMonthDay","minDays","priority","sortOrder")
  SELECT 'psd_' || left(md5(v_tenant || ':season:' || x.k), 20), v_tenant, x.name::jsonb, x.s, x.e, x.min_days, x.prio, x.sort
  FROM (VALUES
    ('low',  '{"el":"Χαμηλή","en":"Low"}',   '10-16', '04-30', NULL, 0, 10),
    ('mid',  '{"el":"Μέση","en":"Mid"}',     '05-01', '10-15', NULL, 0, 20),
    ('high', '{"el":"Υψηλή","en":"High"}',   '07-01', '09-15', 3,    1, 30)
  ) AS x(k, name, s, e, min_days, prio, sort)
  ON CONFLICT DO NOTHING;

  /* ── Τιμές: 3 κλίμακες ανά ομάδα × σεζόν (Χαμηλή = βάση, Μέση ×1,4, Υψηλή ×2) ── */
  FOR g IN SELECT "id", "basePriceCents" FROM "rental_groups" WHERE "tenantId" = v_tenant LOOP
    FOR s IN
      SELECT se."id", CASE se."id"
               WHEN 'psd_' || left(md5(v_tenant || ':season:mid'), 20)  THEN 1.4
               WHEN 'psd_' || left(md5(v_tenant || ':season:high'), 20) THEN 2.0
               ELSE 1.0 END AS factor
      FROM "seasons" se
      WHERE se."tenantId" = v_tenant AND se."id" LIKE 'psd_%'
    LOOP
      p := (round(g."basePriceCents" * s.factor / 100.0) * 100)::int;
      INSERT INTO "rates" ("id","tenantId","seasonId","rentalGroupId","tiers")
      VALUES (
        'psd_' || left(md5(v_tenant || ':rate:' || g."id" || ':' || s."id"), 20), v_tenant, s."id", g."id",
        jsonb_build_array(
          jsonb_build_object('minDays', 1, 'maxDays', 3,    'dailyPriceCents', p),
          jsonb_build_object('minDays', 4, 'maxDays', 6,    'dailyPriceCents', (round(p * 0.9 / 100.0) * 100)::int),
          jsonb_build_object('minDays', 7, 'maxDays', NULL, 'dailyPriceCents', (round(p * 0.8 / 100.0) * 100)::int)
        )
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  /* ── Extras (υπάρχων πίνακας, ποσά σε €) — μόνο αν δεν υπάρχουν ήδη με το ίδιο όνομα ── */
  INSERT INTO "extras" ("id","tenantId","name","price","chargeType","type","nameI18n","descriptionI18n","maxTotal","maxQuantity","vehicleTypes","sortOrder","updatedAt")
  SELECT 'psd_' || left(md5(v_tenant || ':extra:' || x.k), 20), v_tenant, x.name, x.price, 'PER_DAY'::"ChargeType", 'EXTRA'::"ExtraType",
         x.i18n::jsonb, x.descr::jsonb, x.max_total, x.max_qty, x.types::text[], x.sort, CURRENT_TIMESTAMP
  FROM (VALUES
    ('gps',    'GPS',                5.00, '{"el":"GPS","en":"GPS"}', '{"el":"Πλοήγηση στα ελληνικά και αγγλικά.","en":"Navigation in Greek and English."}', 35.00, 1, '{car}', 10),
    ('driver', 'Πρόσθετος οδηγός',  5.00, '{"el":"Πρόσθετος οδηγός","en":"Additional driver"}', '{"el":"Ένας ακόμα οδηγός με τις ίδιες προϋποθέσεις.","en":"One more driver, same requirements."}', 35.00, 2, '{}', 20),
    ('seat',   'Παιδικό κάθισμα',   4.00, '{"el":"Παιδικό κάθισμα","en":"Child seat"}', '{"el":"Για παιδιά 9–36 κιλών.","en":"For children 9–36 kg."}', 28.00, 2, '{car}', 30)
  ) AS x(k, name, price, i18n, descr, max_total, max_qty, types, sort)
  WHERE NOT EXISTS (
    SELECT 1 FROM "extras" e WHERE e."tenantId" = v_tenant AND lower(e."name") = lower(x.name)
  )
  ON CONFLICT DO NOTHING;

  /* ── Βασική ασφάλεια = προεπιλογή (μόνο αν η εταιρία δεν έχει ήδη προεπιλογή) ──
     · Υπάρχουν ασφάλειες: γίνεται προεπιλογή η «βασική» (όνομα με «βασικ»/«basic»),
       αλλιώς η φθηνότερη.
     · Δεν υπάρχει καμία: προστίθεται «Βασική ασφάλεια» (0 €/ημέρα, απαλλαγή 800 €). */
  IF NOT EXISTS (SELECT 1 FROM "extras" WHERE "tenantId" = v_tenant AND "type" = 'INSURANCE' AND "isDefault") THEN
    IF EXISTS (SELECT 1 FROM "extras" WHERE "tenantId" = v_tenant AND "type" = 'INSURANCE') THEN
      UPDATE "extras" SET "isDefault" = true, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = (
        SELECT "id" FROM "extras"
        WHERE "tenantId" = v_tenant AND "type" = 'INSURANCE'
        ORDER BY ("name" ILIKE '%βασικ%' OR "name" ILIKE '%basic%') DESC, "isActive" DESC, "price" ASC, "name" ASC
        LIMIT 1
      );
    ELSE
      INSERT INTO "extras" ("id","tenantId","name","price","chargeType","type","excess","nameI18n","descriptionI18n","isDefault","sortOrder","updatedAt")
      VALUES ('psd_' || left(md5(v_tenant || ':insurance:basic'), 20), v_tenant, 'Βασική ασφάλεια', 0, 'PER_DAY', 'INSURANCE', 800,
              '{"el":"Βασική ασφάλεια","en":"Basic insurance"}'::jsonb,
              '{"el":"Περιλαμβάνεται στην τιμή, με απαλλαγή 800 €.","en":"Included in the price, with an excess of 800 €."}'::jsonb,
              true, 0, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  /* ── Ενότητες εμπιστοσύνης + εμφάνιση (μόνο αν δεν έχουν οριστεί) ── */
  UPDATE "tenants" SET "storefrontSettings" = "storefrontSettings" || jsonb_build_object('trustBlocks', jsonb_build_array(
      jsonb_build_object('icon','Wallet','title',jsonb_build_object('el','Χωρίς προκαταβολή','en','No prepayment'),
        'text',jsonb_build_object('el','Πληρώνετε κατά την παραλαβή.','en','You pay on pick-up.')),
      jsonb_build_object('icon','Plane','title',jsonb_build_object('el','Παράδοση σε αεροδρόμιο/λιμάνι','en','Airport & port delivery'),
        'text',jsonb_build_object('el','Σας περιμένουμε στην άφιξη.','en','We meet you on arrival.')),
      jsonb_build_object('icon','MoonStar','title',jsonb_build_object('el','Χωρίς χρέωση μετά τα μεσάνυχτα','en','No after-midnight fee'),
        'text',jsonb_build_object('el','Παράδοση και αργά το βράδυ, χωρίς επιβάρυνση.','en','Late-night delivery at no extra cost.')),
      jsonb_build_object('icon','ShieldCheck','title',jsonb_build_object('el','Ασφάλεια','en','Insurance'),
        'text',jsonb_build_object('el','Βασική ασφάλεια σε κάθε ενοικίαση.','en','Basic insurance with every rental.'))
    ))
  WHERE "id" = v_tenant AND NOT ("storefrontSettings" ? 'trustBlocks');

  UPDATE "tenants" SET "storefrontSettings" = "storefrontSettings" || jsonb_build_object('theme', jsonb_build_object(
      'accentColor', '#4B3A8E', 'cornerStyle', 'pill', 'heroImage', NULL,
      'heroTitle', jsonb_build_object('el','Ενοικιάσεις αυτοκινήτων στα Χανιά','en','Car rentals in Chania'),
      'heroSubtitle', jsonb_build_object('el','Παράδοση σε αεροδρόμιο, λιμάνι και ξενοδοχείο.','en','Delivery to airport, port and hotel.')))
  WHERE "id" = v_tenant AND NOT ("storefrontSettings" ? 'theme');
END $$;

COMMIT;

-- Verification (αναμενόμενο στην πρώτη εκτέλεση, αν η εταιρία δεν είχε τίποτα):
--   locations = 9 · age_bands = 3 · groups = 9 · seasons = 3 · rates = 27 · demo_extras = 3 · trust_blocks = 4
--   default_insurance = 1 (πάντα 1: μία προεπιλεγμένη ασφάλεια για όλους τους τύπους)
-- (demo_extras < 3 αν υπήρχαν ήδη extras με το ίδιο όνομα — σωστό.)
SELECT
  (SELECT count(*) FROM "pickup_locations" l JOIN "tenants" t ON t."id" = l."tenantId" WHERE t."slug" = 'p-rentals') AS locations,
  (SELECT count(*) FROM "driver_age_bands" b JOIN "tenants" t ON t."id" = b."tenantId" WHERE t."slug" = 'p-rentals') AS age_bands,
  (SELECT count(*) FROM "rental_groups" g JOIN "tenants" t ON t."id" = g."tenantId" WHERE t."slug" = 'p-rentals') AS groups,
  (SELECT count(*) FROM "seasons" s JOIN "tenants" t ON t."id" = s."tenantId" WHERE t."slug" = 'p-rentals') AS seasons,
  (SELECT count(*) FROM "rates" r JOIN "tenants" t ON t."id" = r."tenantId" WHERE t."slug" = 'p-rentals') AS rates,
  (SELECT count(*) FROM "extras" e JOIN "tenants" t ON t."id" = e."tenantId" WHERE t."slug" = 'p-rentals' AND e."id" LIKE 'psd_%' AND e."type" = 'EXTRA') AS demo_extras,
  (SELECT jsonb_array_length(COALESCE("storefrontSettings"->'trustBlocks','[]')) FROM "tenants" WHERE "slug" = 'p-rentals') AS trust_blocks,
  (SELECT count(*) FROM "extras" e JOIN "tenants" t ON t."id" = e."tenantId"
    WHERE t."slug" = 'p-rentals' AND e."type" = 'INSURANCE' AND e."isDefault") AS default_insurance;
