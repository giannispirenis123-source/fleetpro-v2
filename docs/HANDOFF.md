# FleetPro v2 — Handoff

**Ημερομηνία:** 05/10/2026 · **main πριν από αυτή τη δουλειά:** `363f40d` (PR #10). **SQL `13` έχει τρέξει.** · **Αυτό το branch:** Φάση Β (συνέχεια) — λογότυπο, διπλώματα, link πελάτη. **Θέλει SQL `14` ΠΡΙΝ το push/merge.**

> **Επόμενο βήμα:** τρέξε το `prisma/sql/14-contract-branding-link.sql` στη Supabase (verification `1 | 2 | 1`) και μόνο τότε push/merge. Μετά: Φάση Γ (§8.1) και μεταφορά υπογραφών σε Storage (απομένει, δεν έγινε εσκεμμένα).

---

## 1. Τι είναι

Multi-tenant SaaS για ελληνικές εταιρίες ενοικίασης αυτοκινήτων. Κάθε εταιρία (`Tenant`) έχει στόλο, πελάτες, κρατήσεις, τιμολόγια και χρήστες. Πάνω από όλα υπάρχει Super Admin πλατφόρμας.

**Stack:** Next.js 14.1.3 (App Router) · React 18 · TypeScript · Prisma 5.22 · PostgreSQL (Supabase) · JWT με `jose` · bcryptjs (12 rounds) · zod · lucide-react · καθαρό CSS (όχι Tailwind).

## 2. Πού ζει — και η ροή deploy

- **GitHub:** `giannispirenis123-source/fleetpro-v2`, branch `main`
- **Vercel:** auto-deploy σε κάθε push στο `main`
- **Supabase:** η PostgreSQL. Ο Giannis δουλεύει **μόνο από κινητό/browser** — ο agent **δεν** έχει πρόσβαση σε Supabase/Vercel.

**Η ροή είναι πάντα η ίδια και δεν παρακάμπτεται:**

1. Ο agent γράφει τον κώδικα **και** αρχείο `prisma/sql/NN-*.sql` (idempotent).
2. Δίνει το SQL στη συζήτηση, σε **ένα** block.
3. Ο Giannis το τρέχει στο **Supabase SQL Editor** και επιβεβαιώνει το verification SELECT.
4. **Μόνο τότε** λέει «push».

Push πριν το SQL = σπασμένη παραγωγή (ο κώδικας ζητά στήλες που δεν υπάρχουν).

## 3. Env vars (ονόματα μόνο)

| Μεταβλητή | Ρόλος | Πού |
|---|---|---|
| `DATABASE_URL` | Σύνδεση Supabase PostgreSQL (pooled, pgBouncer, πόρτα 6543) | Vercel + `.env.local` |
| `DIRECT_URL` | Απευθείας σύνδεση (πόρτα 5432) — το ζητά το `schema.prisma` | Vercel + `.env.local` |
| `JWT_SECRET` | Υπογραφή JWT (≥32 χαρακτήρες· χωρίς αυτό η εφαρμογή σταματά) | Vercel + `.env.local` |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | Διαβάζονται **μόνο** από το `prisma/seed.ts` — η εφαρμογή δεν τα χρειάζεται | τοπικά, αν τρέξει το seed |
| `SUPABASE_URL` | Η διεύθυνση του project, **ακριβώς `https://<ref>.supabase.co`** (χωρίς διαδρομή). Supabase → Project Settings → API (Data API) → Project URL | Vercel (όλα τα environments) |
| `SUPABASE_SERVICE_ROLE_KEY` | Κλειδί **μόνο για τον server** (Storage). Supabase → Project Settings → API Keys → `service_role` (legacy, `eyJ…`) **ή** ένα νέο Secret key (`sb_secret_…`) — δουλεύουν και τα δύο. **Ποτέ** με πρόθεμα `NEXT_PUBLIC_`, ποτέ στον client | Vercel (όλα τα environments) |

Χωρίς τα δύο `SUPABASE_*` η εφαρμογή δουλεύει κανονικά· απλώς το ανέβασμα φωτογραφιών απαντά ποια μεταβλητή λείπει (503) και οι υπάρχουσες δεν εμφανίζονται. Το `SUPABASE_URL` πρέπει να είναι `https://<ref>.supabase.co`. Ο έλεγχος (`normalizeSupabaseUrl` στο `src/lib/storage.ts`, **ένα** σημείο για ανέβασμα, signed URLs και έλεγχο εκκίνησης) ανέχεται μικρές διαφορές αντιγραφής: κενά/αλλαγές γραμμής και εισαγωγικά γύρω από την τιμή, «/» στο τέλος, καταλήξεις `/rest/v1`, `/storage/v1`, `/auth/v1`. Αν δοθεί διεύθυνση του dashboard (`supabase.com/dashboard/project/<ref>`), σχηματίζεται αυτόματα το `https://<ref>.supabase.co` και γράφεται στα logs ότι έγινε διόρθωση (χωρίς την τιμή). Οτιδήποτε άλλο → το σαφές μήνυμα `CONFIG_INVALID_URL`. Tests: `npm test` (`tests/supabase-url.test.mjs`, με τον ενσωματωμένο `node:test`). Στην εκκίνηση (`src/instrumentation.ts`) γράφεται στα logs `[FleetPro] Supabase Storage: ρυθμίσεις εντάξει` ή τι φταίει.

`STORAGE_ALLOW_LOCAL_URL=1` υπάρχει **μόνο για τοπικές δοκιμές** με mock Storage σε `http://localhost` — **ποτέ** στο Vercel.

### 3.1 Supabase Storage

- **Bucket:** `fleetpro-files` (το όνομα είναι σταθερά στον κώδικα: `STORAGE_BUCKET` στο `src/lib/storage.ts`).
- **Ρυθμίσεις:** Public bucket = **OFF** (ιδιωτικό) · Restrict file size = **5 MB** · Allowed MIME types = `image/jpeg, image/png, image/webp`.
- **Policies (RLS):** καμία. Ο server μιλά με service role, που παρακάμπτει τις policies· χωρίς policies κανείς άλλος (anon/authenticated) δεν διαβάζει ή γράφει.
- **Διαδρομές:** `tenantId/contractId/pickup|return/<τυχαίο>.jpg` για συμβόλαια, `tenantId/damages/damageId/<τυχαίο>.jpg` για ζημιές, `tenantId/branding/logo-<τυχαίο>.<png|jpg|webp>` για το λογότυπο, `tenantId/contractId/licenses/<driverId>-<front|back>-<τυχαίο>.jpg` για διπλώματα.
- Προβολή μόνο με **signed URLs** που βγαίνουν σε κάθε φόρτωση σελίδας: 1 ώρα (ζημιές/λογότυπο στο dashboard), **10 λεπτά** για διπλώματα και για ό,τι δείχνει η σελίδα πελάτη.
- `NEXT_PUBLIC_APP_URL` (προαιρετικό): βασικό URL για το link πελάτη/QR. Αν λείπει, χρησιμοποιείται το host του αιτήματος.

Τιμές: **γνωστές στον Giannis**, ποτέ στη συζήτηση ή σε αρχείο.

## 4. Το μοτίβο για νέα σελίδα

```
prisma/schema.prisma  →  prisma/sql/NN-*.sql  →  src/lib/<feature>.ts (DTO)
  →  src/app/api/<feature>/route.ts (+ [id]/route.ts)
  →  src/app/(dashboard)/dashboard/<feature>/page.tsx (server)
  →  .../<feature>Client.tsx  →  permissions.ts  →  el.ts + en.ts  →  dashboard.css
```

### Κρίσιμα gotchas

- **Prisma:** μόνο `import { db } from "@/lib/db"` (named export).
- **Decimal → `Number()`** πριν περάσει σε client component.
- **`getSession()` async**, μόνο σε server components. Σε API routes: `getSessionFromRequest`.
- **API routes:** πάντα `export const dynamic = "force-dynamic"`.
- **Τα route files δέχονται ΜΟΝΟ συγκεκριμένα exports** (GET/POST/PATCH/DELETE/dynamic). Helpers και zod schemas → `src/lib/*Form.ts`. Το typecheck **δεν** το πιάνει, μόνο το `npm run build`.
- **Δικαιώματα, όχι ρόλοι:** `withPermission(handler, "key")` στα API, `pageGuard("key")` στις σελίδες. Διαβάζουν από τη **βάση** σε κάθε αίτημα (όχι από το JWT), οπότε αλλαγή ισχύει αμέσως.
- **Ο server ξαναϋπολογίζει κάθε ποσό** από ids. Τα zod schemas δεν έχουν καν πεδία ποσών — ό,τι στείλει ο client αγνοείται.
- **Tenant-scoped παντού:** το `tenantId` πάντα από το session.
- **Στεγανότητα PARTNER:** `bookingScope(viewer)` στο ερώτημα, όχι στο UI.
- **CSS:** `dash-*` στο dashboard, `sa-*` στο super-admin, `login-*` στο login. Μεταβλητές στο `globals.css`.
- **i18n:** το `en.ts` τυποποιείται πάνω στο `el.ts` — κλειδί που λείπει σπάει το typecheck.
- **Μετά από αποθήκευση ρύθμισης:** `router.refresh()`, αλλιώς το Router Cache δείχνει τα παλιά.
- **Ημερομηνίες:** σύγκριση ως κείμενο `"YYYY-MM-DD"`. Προσοχή: κάποιες στήλες είναι `timestamp` με ώρα μέσα στην ημέρα — άνω όριο εύρους = **αρχή της επόμενης ημέρας**, όχι μεσάνυχτα της τελευταίας.
- **Demo δεδομένα:** ΜΗΝ τα αγγίζεις (ids `demo-%`).

## 5. Τι έχει ολοκληρωθεί

| Σελίδα / σύστημα | Κατάσταση |
|---|---|
| Login + JWT + i18n (EL/EN ανά χρήστη) | ✅ |
| Πίνακας (KPIs, ειδοποιήσεις, πρόσφατες κρατήσεις) | ✅ |
| Στόλος (CRUD οχημάτων) | ✅ |
| Πελάτες (CRUD) | ✅ |
| Πρόσθετα + ασφάλεια, rental mode (BOOKING/REQUEST) | ✅ |
| Κρατήσεις: ώρες, χρόνος προετοιμασίας, έλεγχος σύγκρουσης | ✅ |
| Κρατήσεις: υπολογισμός τιμής, στρογγυλοποίηση ανά εταιρία | ✅ |
| Εκπτώσεις εταιρίας (`/dashboard/discounts` + `/api/discounts/validate`) | ✅ |
| Τιμολόγια: έκδοση, ΦΠΑ inclusive, εκτύπωση | ✅ |
| Ημερολόγιο: μηνιαίο + timeline ανά όχημα | ✅ |
| Δικαιώματα ανά χρήστη + σελίδα Χρήστες | ✅ |
| Συνεργάτες: στεγανότητα + προμήθεια με 3 διακόπτες βάσης | ✅ |
| Service & Ζημιές | ✅ |
| Super Admin: εταιρίες, στατιστικά, reset κωδικού | ✅ |
| Super Admin: εκπτώσεις συνδρομών (`PlatformDiscount`, `/api/super-admin/platform-discounts`) | ✅ (χωρίς Stripe) |
| Οικονομικά (`/dashboard/finance`): έξοδα CRUD + σύνοψη έσοδα/έξοδα/κέρδος | ✅ |
| Αναφορές (`/dashboard/reports`): KPIs έτους, μήνες, top 5 οχήματα, κατηγορίες | ✅ |
| Συμβόλαια Φάση Α (`/dashboard/contracts`): δίγλωσσο συμβόλαιο, οδηγοί, υπογραφές, κλείδωμα, εκτύπωση Α4 | ✅ |
| Συμβόλαια Φάση Α+: «+ Νέο συμβόλαιο», πρόσθετα με ΦΠΑ (ένα σύνολο με την κράτηση), κάρτα (μόνο 4 ψηφία), αναζήτηση `searchText` | ✅ |
| Γρήγορο συμβόλαιο «walk-in» (`/dashboard/contracts/new`): πελάτης + κράτηση + συμβόλαιο σε μία transaction, κράτηση που ακολουθεί το συμβόλαιο | ✅ live (`2757fed`, PR #7) |
| Συμβόλαια Φάση Β (1ο κομμάτι): φωτογραφίες ζημιών παραλαβής/παράδοσης με κάμερα (Supabase Storage), φωτογραφίες στις ζημιές της σελίδας Service, χωρίς καύσιμο επιστροφής | ✅ live (`7f8915b`, PR #8) |
| Συμβόλαια Φάση Β (συνέχεια): λογότυπο εταιρίας, φωτογραφίες διπλώματος ανά οδηγό, link πελάτη `/c/[token]` + QR στο Α4 | ✅ στο branch, **θέλει SQL `14`** |

**Σημειώσεις λογικής:**
- ΦΠΑ **inclusive**: το `Booking.total` περιέχει ΦΠΑ. `net = total / (1 + ΦΠΑ/100)`. Το ποσοστό γίνεται snapshot στο τιμολόγιο.
- Αρίθμηση τιμολογίων `INV-001…` ανά tenant, ασφαλής σε ταυτόχρονη έκδοση.
- Προμήθεια: **δυναμική** (δεν παγώνει), πάνω σε ενοίκιο/πρόσθετα/ασφάλεια κατ' επιλογή, **πριν** την έκπτωση. Οι ακυρωμένες δεν μετράνε.
- `partnerId` = ποιος **έφερε** την κράτηση · `createdById` = ποιος την **κατέγραψε**.
- Εκπτώσεις συνδρομών (Super Admin): ποσοστό ή σταθερό €/μήνα σε **μία** εταιρία, `validFrom` → `validUntil` (κενό = μέχρι διακοπής) + `active`. **Μία ενεργή ανά εταιρία** σε επικαλυπτόμενο διάστημα (409). Οι τιμές πλάνων (`PLAN_PRICES`) ζουν πλέον στο `src/lib/platformDiscounts.ts` — το Tenant αποθηκεύει μόνο το πλάνο. **Μόνο αποθήκευση/εμφάνιση**, καμία χρέωση· το Stripe θα τις διαβάσει αργότερα. Το παλιό `PlatformCoupon` (κουπόνια με κωδικό) μένει αχρησιμοποίητο.
- Οικονομικά: **έσοδα = τιμολόγια `PAID` με `paidAt` στο διάστημα, σε `subtotal` (καθαρό, χωρίς ΦΠΑ)** — όχι `total`, ώστε το κέρδος να μη φουσκώνει από το ΦΠΑ. Κέρδος = έσοδα χωρίς ΦΠΑ − έξοδα. Το `Expense.type` μένει **ελεύθερο κείμενο** στη βάση· οι 7 τύποι (`insurance, service, fuel, salary, rent, marketing, other`, πεζά) ελέγχονται στο zod (`src/lib/finance.ts`), και άγνωστη τιμή μετρά ως «other». Δικαιώματα `finance.view/create/edit/delete` — **όχι** στα defaults STAFF/PARTNER. Το `/dashboard/finance` βγήκε από τα `ADMIN_ROUTES` του middleware (ήταν φύλακας ρόλου)· το φυλάει μόνο το `finance.view`.

- **Συμβόλαια (Φάση Α):**
  - **Ένα ανά κράτηση.** Φτιάχνεται από το modal της κράτησης (κουμπί «Συμβόλαιο» → `POST /api/contracts {bookingId}`: επιστρέφει το υπάρχον ή φτιάχνει νέο). Όχι για ακυρωμένες κρατήσεις.
  - **Κωδικός τυχαίος** `C-XXXXXX` (χωρίς 0/O/1/I/L), μοναδικός ανά tenant — στο υπάρχον πεδίο `contractNumber`. `createdById` + `createdByName` από το session.
  - **Καταστάσεις:** `DRAFT` → (υπογράφουν **όλοι** οι οδηγοί) → `SIGNED` → («Ολοκλήρωση», απαιτεί καύσιμο παράδοσης) → `COMPLETED`.
  - **Snapshot** (`Contract.snapshot`, Json): εταιρία, κράτηση (ημερομηνίες/ώρες, ποσά από το snapshot της **κράτησης**), όχημα, extras, ασφάλεια **με απαλλαγή** (από `Extra.excess`), όροι ΕΛ/EN. Ανανεώνεται όσο **δεν** υπάρχει υπογραφή· με την πρώτη υπογραφή **παγώνει**.
  - **Οδηγοί** στο `Contract.drivers` (Json), ο πρώτος = κύριος, προσυμπληρωμένος από τον Πελάτη. Η υπογραφή (base64 PNG) ζει μέσα στον οδηγό. Αλλαγή στοιχείου παραλαβής ενώ υπάρχουν μερικές υπογραφές → οι υπογραφές **σβήνονται** (το UI ρωτά πρώτα).
  - **Κλείδωμα:** μετά την υπογραφή όλων αλλάζουν μόνο `fuelReturn`, `vehicleChanges`, `notes` (ο server επιστρέφει 409 για τα υπόλοιπα). `COMPLETED` = τίποτα.
  - **Διαγραφή:** μόνο πρόχειρο χωρίς υπογραφές (`contracts.delete`).
  - **Ταυτόχρονες αλλαγές:** αισιόδοξο κλείδωμα με `updatedAt` (409 «άλλαξε στο μεταξύ»).
  - **Στεγανότητα:** `contractScope(viewer)` στο `src/lib/contractForm.ts` — ο PARTNER βλέπει μόνο συμβόλαια κρατήσεων με δικό του `partnerId`.
  - **Εκτύπωση:** `/print/contracts/[id]` (route group `(print)`, χωρίς sidebar, `noindex`), component `src/components/contracts/ContractDocument.tsx` (χωρίς hooks — θα το ξαναχρησιμοποιήσει η δημόσια σελίδα της Φάσης Β).
  - **Ρυθμίσεις:** νέα κάρτα «Στοιχεία εταιρίας» (περιοχή, διεύθυνση, ΑΦΜ, ΔΟΥ, τηλέφωνο· επωνυμία/email μόνο ανάγνωση) και «Όροι ενοικίασης» ΕΛ/EN.
  - Δικαιώματα `contracts.view/create/edit/delete`· το STAFF παίρνει view/create/edit (backfill στο `11`), **όχι** delete.
- **Συμβόλαια (Φάση Α+):**
  - **«+ Νέο συμβόλαιο»** στη λίστα (`contracts.create`): παράθυρο με κρατήσεις **χωρίς** συμβόλαιο, όχι ακυρωμένες, με `bookingScope` (`GET /api/contracts/bookings?q=`). Η επιλογή καλεί το ίδιο `POST /api/contracts`.
  - **Τιμές με ΦΠΑ**, όπως στις κρατήσεις. Η ανάλυση δείχνει «εκ των οποίων καθαρό + ΦΠΑ X%» (`splitVatInclusive`, το ΦΠΑ μπαίνει στο snapshot ως `vatRate`). Η στρογγυλοποίηση απορροφάται στις γραμμές (`toDisplayBreakdown`), όπως στις κρατήσεις.
  - **Πρόσθετα στο συμβόλαιο → ΕΝΑ σύνολο.** Το PATCH με `extraIds` ξαναϋπολογίζει την κράτηση με `priceBooking` + `discountOfBooking` (τον ίδιο κώδικα με το PATCH κράτησης, `src/lib/bookingPricing.ts`). Κράτηση, snapshot και συμβόλαιο γράφονται σε **μία** `$transaction`. Ποσά από τον client αγνοούνται.
  - **Κλείδωμα πρόσθετων** (`extrasLockOf`): αλλάζουν μόνο πριν την πρώτη υπογραφή **και** αν η κράτηση δεν έχει τιμολόγιο **και** δεν είναι COMPLETED/CANCELLED. Αλλιώς 409. Εκδομένο τιμολόγιο δεν αλλάζει ποτέ.
  - **Πρόχειρο χωρίς υπογραφές:** το snapshot ξαναπαίρνεται σε κάθε άνοιγμα (`refreshDraftSnapshot`). **Υπογεγραμμένο:** μένει παγωμένο. Αν αλλάξει το σύνολο της κράτησης, η φόρμα δείχνει προειδοποίηση (`bookingTotalNow` ≠ snapshot).
  - **Κάρτα** (`paymentCard` / `depositCard`, JSONB): **μόνο** `{ brand, last4, holder, expiry }`. Strict zod: απορρίπτεται οτιδήποτε άλλο (π.χ. `cvv`), ψηφία ≠ 4 ή μήνας εκτός 01–12. Κρατιέται μόνο με τρόπο «Κάρτα» (και «Δέσμευση κάρτας» για εγγύηση), αλλιώς σβήνεται. Στο αντίγραφο: «Visa •••• 1234, λήξη ΜΜ/ΕΕ».
  - **Αναζήτηση:** στήλη `searchText` (GIN `gin_trgm_ops`), που ξαναϋπολογίζεται σε δημιουργία, αποθήκευση, υπογραφή και ολοκλήρωση (`refreshSearchText`). Η κανονικοποίηση (`normalizeSearch` στο `src/lib/contracts.ts`) κάνει πεζά, βγάζει τόνους και σύμβολα, και τα ελληνικά γράμματα που μοιάζουν με λατινικά γίνονται λατινικά («ΙΚΑ-1234» = «ika1234»). Ημερομηνίες σε ISO, ημ/μήνας/έτος και με όνομα μήνα ΕΛ/EN. Τηλέφωνα και χωρίς +30. Πολλές λέξεις = AND. **Lazy backfill** έως 200 συμβόλαια με κενό `searchText` πριν από κάθε αναζήτηση. 25 ανά σελίδα, debounce 300ms.
  - Το `searchText` **δεν** ενημερώνεται αν αλλάξει μόνο ο πελάτης από τη σελίδα Πελατών. Ενημερώνεται στην επόμενη αποθήκευση του συμβολαίου.
  - Το `ContractTemplate` και τα παλιά πεδία `content`, `signatureData`, `signature2Data` μένουν αχρησιμοποίητα. Το `invoiceIssueTrigger = ON_CONTRACT` **δεν** ενεργοποιήθηκε ακόμα.
- **Γρήγορο συμβόλαιο «walk-in»:**
  - **«+ Νέο συμβόλαιο»** (λίστα Συμβολαίων) → `/dashboard/contracts/new` όταν ο χρήστης έχει `contracts.create` **και** `bookings.create`· αλλιώς (μόνο `contracts.create`) ανοίγει το παλιό παράθυρο κρατήσεων. Στη φόρμα, το link «Από υπάρχουσα κράτηση» ανοίγει το ίδιο παράθυρο (`NewContractModal.tsx`, ένα αρχείο για τα δύο σημεία). Το κουμπί «Συμβόλαιο» του modal κράτησης δεν άλλαξε.
  - **Φόρμα:** πελάτης (αναζήτηση όνομα/τηλέφωνο/email με debounce, ή «Νέος πελάτης» με όνομα, επώνυμο, τηλέφωνο, email προαιρετικό), παραλαβή = τώρα στρογγυλεμένη πάνω στο τέταρτο (μπαίνει μετά το mount, με την ώρα του browser), επιστροφή +1 ημέρα, όχημα **μόνο από τα διαθέσιμα** (όσοι έχουν `bookings.override` βλέπουν και τα μη διαθέσιμα με τικ), πρόσθετα/ασφάλεια όπως στο συμβόλαιο, κωδικός έκπτωσης, συνεργάτης (όχι για PARTNER).
  - **Τιμή:** η προεπισκόπηση έρχεται από τον server (`POST /api/contracts/walk-in {preview:true}` → `priceBooking`, άρα `roundUpTotal`, έκπτωση και ΦΠΑ ακριβώς όπως στην αποθήκευση). Ανάλυση καθαρό + ΦΠΑ με `splitVatInclusive`, στρογγυλοποίηση απορροφημένη (`toDisplayBreakdown`).
  - **Διπλότυπα:** τηλέφωνο συγκρίνεται σε ψηφία (χωρίς κενά/παύλες/+30/0030, τελευταία 10), email χωρίς πεζά/κεφαλαία. Η φόρμα προτείνει τον υπάρχοντα όσο γράφεις· ο server απαντά 409 `{conflicts:{duplicates}}` εκτός αν σταλεί `allowDuplicate: true` («Νέος πελάτης παρ' όλα αυτά»).
  - **Server:** `POST /api/contracts/walk-in` (`withPermission(["contracts.create","bookings.create"])`). Η κράτηση φτιάχνεται από τον **ίδιο** κώδικα με το `POST /api/bookings`: η λογική βγήκε στο `src/lib/bookingCreate.ts` (`prepareBooking` = έλεγχοι/σύγκρουση/override/τιμή/partner χωρίς εγγραφές, `writeBooking(tx, …)` = αρίθμηση, εγγραφή, snapshot extras, χρήση κωδικού, δέσμευση οχήματος). Και το POST κράτησης τρέχει πλέον μέσα σε `$transaction`. Νέος πελάτης + κράτηση + συμβόλαιο (`createContractInTx`) σε **μία** `$transaction` (timeout 20s): αν αποτύχει οτιδήποτε, δεν γράφεται τίποτα (ούτε η χρήση του κωδικού ούτε η κατάσταση οχήματος). Ο κωδικός συμβολαίου μέσα σε transaction βρίσκεται με ανάγνωση πριν την εγγραφή (ένα σφάλμα P2002 θα ακύρωνε όλη την transaction).
  - **Κατάσταση κράτησης:** `CONFIRMED` πάντα (και σε `rentalMode = REQUEST`: ο πελάτης είναι παρών), `source = "walk-in"` (η στήλη `Booking.source` υπήρχε ήδη — γι' αυτό **χωρίς SQL**). Στη λίστα Κρατήσεις φαίνεται η ένδειξη «Από συμβόλαιο»· στο Ημερολόγιο εμφανίζεται όπως κάθε κράτηση.
  - **Η κράτηση ακολουθεί το συμβόλαιο** (`src/lib/bookingLifecycle.ts`, για **όλα** τα συμβόλαια, και από υπάρχουσα κράτηση): υπογραφή όλων → `ACTIVE`, ολοκλήρωση συμβολαίου → `COMPLETED`. Μόνο προς τα εμπρός στη διαδρομή `CONFIRMED → ACTIVE → COMPLETED`, βήμα-βήμα μέσα από τις `STATUS_TRANSITIONS`, στην ίδια transaction με το συμβόλαιο. Ποτέ από `CANCELLED`, ποτέ προς τα πίσω, και **ποτέ από `PENDING`** (αίτημα που δεν εγκρίθηκε μένει στον άνθρωπο). Δεν απαιτεί `bookings.status`: είναι συνέπεια του συμβολαίου (`contracts.edit`). Με το `COMPLETED` τρέχει ο **ίδιος** μηχανισμός `ON_COMPLETION` τιμολογίου με το PATCH κράτησης (`issueInvoiceOnCompletion`) και ο συγχρονισμός οχήματος (`syncVehicleStatus`, μεταφέρθηκε από το route στο lib).
  - **Σύγκρουση:** ίδια με τις κρατήσεις — 409 με τη λίστα· `override: true` μόνο με `bookings.override` (STAFF → 403). Στη φόρμα ο STAFF δεν βλέπει κουμπί αποθήκευσης όσο υπάρχει σύγκρουση.
  - **PARTNER:** μόνο με **και τα δύο** δικαιώματα· `partnerId` κλειδωμένο στον εαυτό του (`resolvePartnerId`), άρα βλέπει μόνο τα δικά του (`bookingScope`/`contractScope`). Δεν έχει τα δικαιώματα στα defaults. Ο νέος πελάτης φτιάχνεται χωρίς `customers.create` (αρκούν τα δύο δικαιώματα, όπως αποφασίστηκε).
  - Βοηθητικά API: `GET /api/contracts/walk-in?pickupDate&pickupTime&returnDate&returnTime[&all=1]` (διαθέσιμα οχήματα, ένα ερώτημα για όλο τον στόλο + `findConflicts` με προετοιμασία· εξαιρούνται `MAINTENANCE`/`INACTIVE`) και `GET /api/contracts/walk-in/customers?q=` / `?phone=&email=`.
- **Φωτογραφίες ζημιών (Φάση Β, 1ο κομμάτι):**
  - **Αποθήκευση:** Supabase Storage, ιδιωτικό bucket `fleetpro-files` (§3.1), μέσω του REST API με `fetch` από τον server (`src/lib/storage.ts`, καμία νέα εξάρτηση). Το κλειδί δεν φεύγει ποτέ από τον server· στα logs γράφεται μόνο ο κωδικός HTTP.
  - **Κοινός κώδικας:** `src/lib/photos.ts` (έλεγχος αρχείου από τα πρώτα bytes — JPEG/PNG/WebP, όριο **4 MB** ανά αρχείο λόγω του ορίου 4,5 MB του Vercel, τυχαίο όνομα, ανέβασμα) και ένα component `src/components/photos/PhotoManager.tsx` (κουμπιά «📷 Κάμερα» με `capture="environment"` και «Συλλογή», συμπίεση στον browser `src/lib/imageCompress.ts` σε 1600px / JPEG 0.8 που σβήνει και τα EXIF/GPS, ανέβασμα ένα-ένα με πρόοδο, «Ξανά» σε αποτυχία, μικρογραφίες, σημείωση, διαγραφή). Τα χρησιμοποιούν **και** τα συμβόλαια **και** οι ζημιές.
  - **Συμβόλαιο:** ενότητα «Ζημιές» με ομάδες **Παραλαβή** / **Παράδοση** (αντί για σκαρίφημα), φωτογραφίες + ελεύθερη περιγραφή ανά ομάδα. Στήλες `contracts."damagePhotos"` (JSONB `[{id, path, group, takenAt, note}]`), `"damageNotesPickup"`, `"damageNotesReturn"` (migration `13`). Όριο **40** φωτογραφίες ανά συμβόλαιο. Ώρα λήψης από το `lastModified` του αρχείου (λογικές τιμές μόνο, αλλιώς ώρα server).
  - **Κανόνες (`photoLockOf`, ίδιος σε UI και server):** παραλαβή → προσθήκη/διαγραφή/σημείωση **μόνο πριν την πρώτη υπογραφή**· παράδοση → μέχρι την **ολοκλήρωση**. Η περιγραφή παραλαβής είναι στοιχείο παραλαβής (κλειδώνει όπως τα άλλα)· η περιγραφή παράδοσης αλλάζει και μετά την υπογραφή.
  - **Ανεξάρτητα από τη φόρμα:** οι φωτογραφίες ανεβαίνουν αμέσως (`POST/PATCH/DELETE /api/contracts/[id]/photos[/photoId]`) με raw SQL μέσα σε transaction με `SELECT … FOR UPDATE` και **χωρίς** να αλλάζει το `updatedAt` — αλλιώς το αισιόδοξο κλείδωμα της φόρμας θα έβγαζε «άλλαξε στο μεταξύ». Αποτυχία ανεβάσματος = καθαρό μήνυμα + «Ξανά»· η φόρμα και η αποθήκευσή της δεν επηρεάζονται. Αν αποτύχει η εγγραφή στη βάση, το αρχείο σβήνεται. Διαγραφή: πρώτα η βάση, μετά το αρχείο.
  - **Δικαιώματα:** ανέβασμα/σημείωση/διαγραφή `contracts.edit`, προβολή `contracts.view`· `contractScope` (tenant + PARTNER μόνο τα δικά του → 404 στα ξένα). Το middleware αφήνει ήδη τα `/api/*` στους δικούς τους φύλακες· δεν χρειάστηκε αλλαγή.
  - **Καύσιμο επιστροφής:** βγήκε από τη φόρμα και το αντίγραφο· η «Ολοκλήρωση» δεν το απαιτεί πια. Η στήλη `fuelReturn` **μένει** (όχι drop)· σε παλιά συμβόλαια με τιμή εμφανίζεται μόνο για ανάγνωση. Το PATCH δεν το δέχεται πια.
  - **Παλιό σκαρίφημα:** τα `damageMarks` **μένουν**· αν υπάρχουν, εμφανίζονται μικρά και μόνο για ανάγνωση στη φόρμα και στο αντίγραφο. Τα νέα συμβόλαια δεν έχουν σκαρίφημα, και το PATCH δεν δέχεται πια `damageMarks`.
  - **Αντίγραφο Α4:** συμπαγές πλέγμα 6 μικρογραφιών ανά σειρά (ύψος 22mm) ανά ομάδα με ετικέτα ΕΛ/EN, ώρα λήψης και σημείωση· οι ομάδες τυπώνονται μόνο αν έχουν φωτογραφίες ή περιγραφή. Το κουμπί «Εκτύπωση» περιμένει να φορτώσουν οι εικόνες (έως 15″) πριν ανοίξει το παράθυρο.
  - **Service & Ζημιές:** ίδιο component στη φόρμα της ζημιάς (μόνο σε αποθηκευμένη ζημιά) + κουμπί 📷 με το πλήθος στη γραμμή (προβολή για όσους έχουν `damages.view`). Αποθήκευση στο υπάρχον `damages.photos` (TEXT[]) ως διαδρομές, ατομικά με `array_append`/`array_remove`, όριο **20**. Ανέβασμα/διαγραφή `damages.edit`, προβολή `damages.view`. Τιμές που είναι ήδη URL (παλιά) εμφανίζονται ως έχουν. Η διαγραφή ζημιάς ή πρόχειρου συμβολαίου σβήνει και τα αρχεία (best effort).
  - Το `searchText` **δεν** περιέχει φωτογραφίες ή περιγραφές ζημιών.
  - **Σφάλματα Storage (συγκεκριμένα, ασφαλή):** κάθε αποτυχία γίνεται `StorageError` με κωδικό, και ο server απαντά `{ message, code }`. Το UI δείχνει το `message` στην ουρά ανεβάσματος (με «Ξανά»):

    | Αιτία | `code` | HTTP | Μήνυμα (σύνοψη) |
    |---|---|---|---|
    | Λείπει env var | `CONFIG_MISSING` | 503 | «Λείπει η μεταβλητή SUPABASE_… » (όνομα, ποτέ τιμή) |
    | Λάθος μορφή URL | `CONFIG_INVALID_URL` | 503 | «πρέπει να ξεκινά με https:// και να τελειώνει σε .supabase.co» |
    | Storage 401/403 | `AUTH` | 502 | λάθος κλειδί στο `SUPABASE_SERVICE_ROLE_KEY` (όχι anon/publishable) |
    | Storage 404 | `BUCKET_NOT_FOUND` | 502 | δεν βρέθηκε το bucket `fleetpro-files` (ή άλλο project) |
    | Storage 400/415 | `REJECTED_TYPE` | 415 | Allowed MIME types του bucket |
    | Storage 413 | `REJECTED_SIZE` | 413 | όριο μεγέθους του bucket |
    | Δίκτυο | `NETWORK` | 502 | δεν υπάρχει σύνδεση με το Storage |

    Η Supabase συχνά απαντά HTTP 400 με `statusCode` μέσα στο σώμα (π.χ. `"404"` + «Bucket not found»)· η κατάταξη κοιτά πρώτα αυτό. **Logs:** `Storage upload: HTTP 400 → BUCKET_NOT_FOUND — statusCode 404 · Bucket not found`· το κείμενο της Supabase περνά από `scrub()` (βγάζει URLs, JWT, `sb_secret_…`, `token=`/`key=`, `Bearer`), σε σφάλμα δικτύου γράφεται μόνο ο κωδικός (π.χ. `ECONNREFUSED`). Όταν η απάντηση δεν είναι JSON (π.χ. 413 του Vercel), το UI δείχνει μήνυμα ανά HTTP status. Τα ίδια ισχύουν για τις ζημιές της σελίδας Service.

- **Λογότυπο εταιρίας (Φάση Β, συνέχεια):**
  - **Ρυθμίσεις → «Στοιχεία εταιρίας»:** ανέβασμα (JPEG/PNG/WebP — όχι SVG· ο server ελέγχει τα πρώτα bytes), προεπισκόπηση, «Αλλαγή», «Αφαίρεση». Σμίκρυνση στον browser (`compressLogo` στο `src/lib/imageCompress.ts`): μέγιστη πλευρά 600px, ο τύπος μένει ίδιος (PNG/WebP κρατούν διαφάνεια, JPEG μένει JPEG).
  - `POST/DELETE /api/settings/logo` με `settings.edit` (ίδιο κλειδί με το PATCH των Ρυθμίσεων). Στήλη `tenants."logoPath"`· η αλλαγή γίνεται με `FOR UPDATE` και **σβήνει το παλιό αρχείο** μετά την εγγραφή. Το παλιό `logoUrl` μένει αχρησιμοποίητο.
  - **Εμφάνιση:** δεξιά στην κεφαλίδα (φόρμα, Α4, σελίδα πελάτη), σταθερό μέγιστο ύψος. Πάντα το **τρέχον** λογότυπο (`tenantLogoUrl`), όχι του snapshot — άρα και στα παλιά συμβόλαια. Χωρίς λογότυπο η θέση μένει κενή (το placeholder «Λογότυπο / Logo» του Α4 έφυγε).
- **Φωτογραφίες διπλώματος:**
  - Ανά οδηγό «Δίπλωμα: Εμπρός» / «Πίσω» (προαιρετικά), με το **ίδιο** `PhotoManager` (νέα props `replace` = μία θέση με αντικατάσταση, `canDelete`) και την ίδια συμπίεση με τις ζημιές. Μόνο σε αποθηκευμένο οδηγό.
  - Διαδρομές στο JSON του οδηγού: `drivers[].licensePhotos: { front?, back? }` (χωρίς στήλη). Ο client **δεν** τις στέλνει ποτέ (το zod του οδηγού τις πετά)· το `toContractDTO` τις αφαιρεί και δίνει μόνο `licensePhotos: [{driverId, side, id, url}]` με signed URL 10′ (`loadContract`).
  - `POST/DELETE /api/contracts/[id]/licenses` (`contracts.edit`, `contractScope` → PARTNER 404 σε ξένα). Raw SQL με `FOR UPDATE`, **χωρίς** αλλαγή `updatedAt`. Κανόνας `licenseLockOf`: ανέβασμα/αντικατάσταση μέχρι την ολοκλήρωση (και μετά τις υπογραφές), διαγραφή μόνο πριν την πρώτη υπογραφή. Η αντικατάσταση σβήνει το παλιό αρχείο.
  - Επειδή το ανέβασμα δεν αλλάζει `updatedAt`, το PATCH και η υπογραφή που ξαναγράφουν τους οδηγούς παίρνουν τις **τρέχουσες** διαδρομές με κλείδωμα της γραμμής (`withLatestLicensePhotos`). Αφαιρεμένος οδηγός → σβήνονται τα αρχεία του. Διαγραφή πρόχειρου → σβήνονται κι αυτά.
  - **Ποτέ** στο Α4, στη σελίδα πελάτη, στο `searchText` ή σε δημόσιο endpoint.
- **Link πελάτη `/c/[token]`:**
  - Στήλες `contracts."publicToken"` (UNIQUE) και `"publicTokenRevokedAt"`. Token 32 τυχαία bytes, base64url (43 χαρακτήρες) — `src/lib/contractLink.ts` (καθαρή λογική, χωρίς runtime imports, με tests).
  - Φτιάχνεται **αυτόματα** με την υπογραφή όλων (sign route). Στη φόρμα, ενότητα «Link πελάτη» (μόνο σε SIGNED/COMPLETED): «Κοινοποίηση» (`navigator.share`, αλλιώς αντιγραφή), «Αντιγραφή link» (`contracts.view`), «Ακύρωση link» / «Νέο link» (`POST /api/contracts/[id]/link {action}`, `contracts.edit`, χωρίς αλλαγή `updatedAt`). Νέο link = νέο token → το παλιό δεν βρίσκεται πια.
  - **Λήξη:** 90 ημέρες μετά την ημερομηνία επιστροφής (ισχύει όλη η 90ή ημέρα), υπολογίζεται (`linkStateOf`). Ληγμένο/ακυρωμένο/άγνωστο → δίγλωσση σελίδα «Το link δεν είναι πλέον διαθέσιμο / This link is no longer available» χωρίς κανένα στοιχείο.
  - **Σελίδα:** server-rendered, χωρίς login, το **ίδιο** `ContractDocument` με `mode="public"` και δεδομένα από `toPublicContract` (ids → αύξοντες, χωρίς διπλώματα, πληρωμή/κάρτα/εγγύηση, παρατηρήσεις, αριθμό κράτησης, συντάκτη). Μικρογραφίες ζημιών με μεγέθυνση στο πάτημα (CSS `:target`, χωρίς JS). Signed URLs 10′, νέα σε κάθε φόρτωση. Αναζήτηση με το unique index (`loadPublicContract`). Κανένα API δεν δίνει δεδομένα με το token.
  - **Ασφάλεια:** το middleware αφήνει ελεύθερη **μόνο** τη διαδρομή `/c/<ένα τμήμα base64url>` και βάζει `X-Robots-Tag: noindex`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`· επιπλέον meta robots/referrer.
  - **Γνωστό όριο:** τα signed URLs της Supabase περιέχουν τη διαδρομή του αρχείου, άρα στα `src` των εικόνων φαίνονται `tenantId`/`contractId`. Στα δεδομένα/κείμενο της σελίδας δεν υπάρχει κανένα id.
  - **QR στο Α4:** μικρό QR (20mm) δίπλα στις υπογραφές, μόνο με ενεργό link — SVG στον server με το πακέτο `qrcode` (`src/lib/contractQr.ts`).

## 6. Migrations

Στο `prisma/sql/`, με σειρά: `01-schema` → `01b-locale` → `02b-extras-rentalmode` → `03-booking-times` → `04-round-up-total` → `05-invoices` → `06-permissions` → `07-partner-commission` → `08-service-damages` → `09-platform-discounts` → `10-finance` → `11-contracts` → `12-contracts-update` → `13-contract-photos` → `14-contract-branding-link`. Το `02-seed` τρέχει οποτεδήποτε μετά το `01-schema`.

- **01 → 07: έχουν τρέξει** (κάθε ένα προηγήθηκε του αντίστοιχου push).
- **08-service-damages:** το push του `46fda54` έγινε μετά από ρητό «push», άρα κατά πάσα πιθανότητα έτρεξε. **Αξίζει επιβεβαίωση** με το verification SELECT του αρχείου (αναμενόμενο `1 | 4 | 1 | 1 | 2 | 0`). Αν δεν έχει τρέξει, η σελίδα Service & Ζημιές και ο Πίνακας σκάνε.
- **09-platform-discounts:** το commit έγινε merge στο `main` (`90d2d70`) κατόπιν ρητού αιτήματος· **αξίζει επιβεβαίωση** ότι έτρεξε (αναμενόμενο verification `1 | 1 | 9 | 1 | 3`). Αν δεν έχει τρέξει, σκάει μόνο το tab «Εκπτώσεις» του `/super-admin`.
- **10-finance:** έχει τρέξει (verification `3 | 0`).
- **12-contracts-update:** έχει τρέξει (verification `3 | 1 | 1`).
- **13-contract-photos:** έχει τρέξει (verification `3 | 0`). `contracts."damagePhotos"` (JSONB, default `[]`), `"damageNotesPickup"`, `"damageNotesReturn"` (TEXT).
- **14-contract-branding-link:** **ΔΕΝ έχει τρέξει ακόμα** — πρέπει να τρέξει πριν το push/merge αυτού του branch. `tenants."logoPath"`, `contracts."publicToken"` (UNIQUE index `contracts_publicToken_key`), `contracts."publicTokenRevokedAt"`. Αναμενόμενο verification `1 | 2 | 1`. Τοπικά (PostgreSQL 16, `01 → 14`): `prisma migrate diff` → «empty migration».
- **Walk-in (02/10/2026): κανένα νέο SQL.** Χρησιμοποιεί την υπάρχουσα `bookings.source`. Τοπική PostgreSQL 16 με `01 → 12`: `prisma migrate diff` → «empty migration».
- **11-contracts:** έχει τρέξει (verification `1 | 4 | 1 | 18 | 2 | 0 | 0`).
- _(ιστορικό 11)_ Enum `ContractStatus`, 18 στήλες στο `contracts`, 4 στο `tenants`, `extras.excess`, unique `(tenantId, contractNumber)`, index `(tenantId, status)`, `contracts.sign` → `contracts.edit`, backfill STAFF. Αναμενόμενο verification `1 | 4 | 1 | 18 | 2 | 0 | 0`. Έτρεξε στο Supabase πριν το merge του PR #5.

Έλεγχος συμφωνίας schema ↔ βάση:
`npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` → πρέπει να λέει «This is an empty migration.»

## 7. Εκκρεμότητες

| Σοβαρότητα | Θέμα |
|---|---|
| 🔴 Υψηλή | **Κωδικός Super Admin σε 3 αρχεία** (`SETUP.md`, `prisma/seed.ts`, `prisma/sql/02-seed.sql`) σε καθαρή μορφή. Πρέπει να αφαιρεθεί από το repo. |
| 🔴 Υψηλή | **Rotate** κωδικού Supabase DB και `JWT_SECRET` — παλιές τιμές υπάρχουν στο git history. |
| ✅ Ολοκληρώθηκε | ~~Εκπτώσεις Super Admin ήταν MOCK~~ → πραγματικές εκπτώσεις συνδρομών (βλ. §5). Απομένει μόνο η σύνδεση με Stripe (§8.7). Ξεχωριστές από τις εκπτώσεις κρατήσεων του `/dashboard/discounts`. |
| 🟡 Χαμηλή | Η σελίδα `/login` βγάζει σφάλματα hydration του React (#425/#418) στον browser — υπήρχαν πριν τα Συμβόλαια, δεν επηρεάζουν τη σύνδεση. |
| 🟡 Χαμηλή | Το `09-platform-discounts` να επιβεβαιωθεί ότι έτρεξε (§6). |
| 🟡 Χαμηλή | Το `08` να επιβεβαιωθεί ότι έτρεξε (§6). |

## 8. Roadmap

**Επόμενο: Συμβόλαια Φάση Β (υπόλοιπο).**

1. **Συμβόλαια** — ✅ Φάση Α (§5). **Φάση Β:** ✅ ιδιωτικό bucket + φωτογραφίες ζημιών παραλαβής/παράδοσης (§5). ✅ λογότυπο, διπλώματα, link πελάτη + QR (§5, θέλει SQL `14`). Απομένει: μεταφορά υπογραφών σε Storage. **Φάση Γ:** «Συμπλήρωση από φωτογραφία» διπλώματος μέσω Anthropic API (μόνο πρόταση, ποτέ αυτόματη αποθήκευση). Επίσης εκκρεμεί το `invoiceIssueTrigger = ON_CONTRACT`.
2. ~~**Οικονομικά**~~ — ✅ ολοκληρώθηκε (§5).
3. ~~**Αναφορές**~~ — ✅ ολοκληρώθηκε (§5).
4. **Τιμολόγια: email** — το `invoiceSendMode = AUTO` και το πεδίο `Invoice.sentAt` υπάρχουν, η αποστολή όχι.
5. **Τιμολόγια: PDF** — σήμερα μόνο εκτύπωση από browser.
6. ~~**Φωτογραφίες ζημιών**~~ — ✅ με Supabase Storage (§5). Το `documents[]` και το πακέτο `cloudinary` μένουν αχρησιμοποίητα.
7. **Billing / Stripe** — συνδρομές εταιριών. Οι εκπτώσεις συνδρομών (`PlatformDiscount`) υπάρχουν ήδη· το billing θα εφαρμόζει την ενεργή με `platformDiscountStatus` + `discountedPrice`.
8. **Δημόσιο site κρατήσεων** — το `/api/discounts/validate` είναι ήδη ανοιχτό γι' αυτό.

## 9. Changelog

| Commit | Τι |
|---|---|
| _(αυτό το commit)_ | Συμβόλαια Φάση Β (συνέχεια): λογότυπο εταιρίας (Ρυθμίσεις, φόρμα/Α4/σελίδα πελάτη), φωτογραφίες διπλώματος ανά οδηγό (μόνο εσωτερικά), link πελάτη `/c/[token]` (αυτόματο με την υπογραφή, ακύρωση/νέο, λήξη 90 ημέρες, noindex/no-store/no-referrer), QR στο Α4 (`qrcode`), tests. Migration `14` |
| `363f40d` | Ανεκτικός έλεγχος `SUPABASE_URL` (κενά, εισαγωγικά, «/», `/rest/v1` κ.λπ., διεύθυνση dashboard → `https://<ref>.supabase.co`) σε ένα σημείο, unit tests με `node:test` (`npm test`). Χωρίς SQL |
| `a2e02a8` | Φωτογραφίες (PR #9): συγκεκριμένο μήνυμα ανά αιτία σφάλματος Storage (env var, μορφή URL, κλειδί, bucket, τύπος/μέγεθος, δίκτυο), ασφαλή logs χωρίς κλειδιά/tokens/URLs, έλεγχος ρυθμίσεων στην εκκίνηση (`instrumentation.ts`). Χωρίς SQL |
| `7f8915b` | Συμβόλαια Φάση Β (1ο κομμάτι) (PR #8, squash): φωτογραφίες ζημιών παραλαβής/παράδοσης με κάμερα και συμπίεση στον browser, ιδιωτικό Supabase Storage με signed URLs, ίδιο component και server κώδικας στις ζημιές της σελίδας Service, αφαίρεση καυσίμου επιστροφής, παλιό σκαρίφημα μόνο για ανάγνωση, migration `13` |
| `2757fed` | Γρήγορο συμβόλαιο «walk-in» (PR #7, squash): `/dashboard/contracts/new`, πελάτης + κράτηση + συμβόλαιο σε μία transaction, κοινή δημιουργία κράτησης (`bookingCreate.ts`), η κράτηση ακολουθεί το συμβόλαιο (ACTIVE/COMPLETED + τιμολόγιο ON_COMPLETION), ένδειξη «Από συμβόλαιο». Χωρίς SQL |
| `7d84ef8` | Συμβόλαια Φάση Α+ (PR #6): «+ Νέο συμβόλαιο», πρόσθετα στο συμβόλαιο με ένα σύνολο κράτησης/συμβολαίου (transaction), ανάλυση με ΦΠΑ, στοιχεία κάρτας μόνο για αναγνώριση, αναζήτηση `searchText` + GIN trigram, σελιδοποίηση, migration `12` |
| `4ecc5f7` | Συμβόλαια Φάση Α (PR #5): δίγλωσσο συμβόλαιο από κράτηση, απεριόριστοι οδηγοί, υπογραφή με δάχτυλο, καύσιμο σε όγδοα, σκαρίφημα ζημιών, αλλαγή οχήματος, κλείδωμα, εκτύπωση Α4, στοιχεία εταιρίας + όροι ΕΛ/EN στις Ρυθμίσεις, απαλλαγή στις ασφάλειες, migration `11` |
| `17a1799` | Σελίδα Αναφορές (PR #4): KPIs έτους, έσοδα/έξοδα ανά μήνα, top 5 οχήματα, κατηγορίες, `reports.view` (όχι PARTNER). Χωρίς SQL |
| `370e0af` | Σελίδα Οικονομικά (PR #3): έξοδα CRUD, σύνοψη έσοδα (χωρίς ΦΠΑ) / έξοδα / κέρδος, `finance.*` δικαιώματα, migration `10` |
| `90d2d70` | Εκπτώσεις συνδρομών Super Admin: `PlatformDiscount`, API `/api/super-admin/platform-discounts`, αντικατάσταση mock, migration `09` |
| `46fda54` | Σελίδα Service & Ζημιές (οι πίνακες υπήρχαν· προστέθηκε `damages.date` + indexes) |
| `d3557ed` | Βάση προμήθειας με 3 ανεξάρτητους διακόπτες + `createdById` + «Οι κρατήσεις μου» |
| `0bf7928` | Κρατήσεις συνεργατών, `partnerId`, αυτόματη προμήθεια, στεγανότητα PARTNER |
| `423436c` | Δικαιώματα ανά χρήστη, σελίδα Χρήστες, 25 φύλακες ρόλου → δικαιώματος |
| `cff46f4` | Σελίδα Ημερολόγιο (μηνιαίο + timeline ανά όχημα) |
| `583c12a` | Τιμολόγια: έκδοση, ΦΠΑ inclusive, εκτύπωση |
| `4770370` | Η στρογγυλοποίηση απορροφάται στις γραμμές |
| `05a5376` | Στρογγυλοποίηση τελικού ποσού ανά εταιρία |
| `de219b0` | Σελίδα Εκπτώσεων εταιρίας |
| `489f613` | Κρατήσεις Βήμα 2 — υπολογισμός τιμής |

_Παλιότερα (`d4d62ac` → `cf262c0`): αρχικό στήσιμο, deploy σε Vercel, seed βάσης, i18n, λευκό θέμα, σελίδες Στόλου/Πελατών/Πρόσθετων, ώρες κρατήσεων, reset κωδικού από Super Admin._

---

## Γρήγορες εντολές

```bash
npx tsc --noEmit        # typecheck
npm run build           # ΠΑΝΤΑ πριν το commit — πιάνει τα invalid route exports
npx prisma generate     # μετά από αλλαγή schema
npm test                # unit tests (node:test, χωρίς εξάρτηση)
```
