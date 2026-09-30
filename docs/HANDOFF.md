# FleetPro v2 — Handoff

**Ημερομηνία:** 30/09/2026 · **main:** `4ecc5f7` (Συμβόλαια Φάση Α) · **Κατάσταση:** Συμβόλαια **Φάση Α+** σε commit τοπικά, **όχι pushed** — περιμένει να τρέξει το `12` στο Supabase

> **Επόμενο βήμα:** ο Giannis τρέχει το `prisma/sql/12-contracts-update.sql` στο Supabase (verification `3 | 1 | 1`) και μετά λέει «push». Έπειτα: Συμβόλαια **Φάση Β** (αρχεία σε Supabase Storage + link πελάτη) και **Φάση Γ** (διάβασμα διπλώματος με AI), §8.1.

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
| Συμβόλαια Φάση Α+: «+ Νέο συμβόλαιο», πρόσθετα με ΦΠΑ (ένα σύνολο με την κράτηση), κάρτα (μόνο 4 ψηφία), αναζήτηση `searchText` | ✅ κώδικας · ⏳ SQL `12` |

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

## 6. Migrations

Στο `prisma/sql/`, με σειρά: `01-schema` → `01b-locale` → `02b-extras-rentalmode` → `03-booking-times` → `04-round-up-total` → `05-invoices` → `06-permissions` → `07-partner-commission` → `08-service-damages` → `09-platform-discounts` → `10-finance` → `11-contracts` → `12-contracts-update`. Το `02-seed` τρέχει οποτεδήποτε μετά το `01-schema`.

- **01 → 07: έχουν τρέξει** (κάθε ένα προηγήθηκε του αντίστοιχου push).
- **08-service-damages:** το push του `46fda54` έγινε μετά από ρητό «push», άρα κατά πάσα πιθανότητα έτρεξε. **Αξίζει επιβεβαίωση** με το verification SELECT του αρχείου (αναμενόμενο `1 | 4 | 1 | 1 | 2 | 0`). Αν δεν έχει τρέξει, η σελίδα Service & Ζημιές και ο Πίνακας σκάνε.
- **09-platform-discounts:** το commit έγινε merge στο `main` (`90d2d70`) κατόπιν ρητού αιτήματος· **αξίζει επιβεβαίωση** ότι έτρεξε (αναμενόμενο verification `1 | 1 | 9 | 1 | 3`). Αν δεν έχει τρέξει, σκάει μόνο το tab «Εκπτώσεις» του `/super-admin`.
- **10-finance:** έχει τρέξει (verification `3 | 0`).
- **12-contracts-update: ΔΕΝ έχει τρέξει ακόμα.** `paymentCard`, `depositCard` (JSONB), `searchText` (TEXT), `CREATE EXTENSION pg_trgm`, GIN index `contracts_searchText_trgm_idx`. Αναμενόμενο verification `3 | 1 | 1`. Δοκιμάστηκε δύο φορές σε τοπική PostgreSQL 16· `prisma migrate diff` → «empty migration». Πρέπει να τρέξει **πριν** το push.
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
| 🟠 Μεσαία | Το `12-contracts-update` να τρέξει στο Supabase πριν το push (§6). |
| 🟡 Χαμηλή | Η σελίδα `/login` βγάζει σφάλματα hydration του React (#425/#418) στον browser — υπήρχαν πριν τα Συμβόλαια, δεν επηρεάζουν τη σύνδεση. |
| 🟡 Χαμηλή | Το `09-platform-discounts` να επιβεβαιωθεί ότι έτρεξε (§6). |
| 🟡 Χαμηλή | Το `08` να επιβεβαιωθεί ότι έτρεξε (§6). |

## 8. Roadmap

**Επόμενο: Συμβόλαια Φάση Β.**

1. **Συμβόλαια** — ✅ Φάση Α (§5). **Φάση Β:** ιδιωτικό bucket στο Supabase Storage, λογότυπο εταιρίας, φωτογραφίες ζημιών παραλαβής/παράδοσης, φωτογραφία διπλώματος (μόνο εσωτερικά, signed URL), δημόσιο link πελάτη `/c/[token]` (λήξη 90 ημέρες μετά την επιστροφή, ακύρωση/επαναδημιουργία, noindex, QR στο αντίγραφο), μεταφορά υπογραφών σε Storage. **Φάση Γ:** «Συμπλήρωση από φωτογραφία» διπλώματος μέσω Anthropic API (μόνο πρόταση, ποτέ αυτόματη αποθήκευση). Επίσης εκκρεμεί το `invoiceIssueTrigger = ON_CONTRACT`.
2. ~~**Οικονομικά**~~ — ✅ ολοκληρώθηκε (§5).
3. ~~**Αναφορές**~~ — ✅ ολοκληρώθηκε (§5).
4. **Τιμολόγια: email** — το `invoiceSendMode = AUTO` και το πεδίο `Invoice.sentAt` υπάρχουν, η αποστολή όχι.
5. **Τιμολόγια: PDF** — σήμερα μόνο εκτύπωση από browser.
6. **Φωτογραφίες ζημιών** — τα πεδία `photos[]` / `documents[]` υπάρχουν, θέλουν Cloudinary.
7. **Billing / Stripe** — συνδρομές εταιριών. Οι εκπτώσεις συνδρομών (`PlatformDiscount`) υπάρχουν ήδη· το billing θα εφαρμόζει την ενεργή με `platformDiscountStatus` + `discountedPrice`.
8. **Δημόσιο site κρατήσεων** — το `/api/discounts/validate` είναι ήδη ανοιχτό γι' αυτό.

## 9. Changelog

| Commit | Τι |
|---|---|
| _(αυτό το commit)_ | Συμβόλαια Φάση Α+: «+ Νέο συμβόλαιο», πρόσθετα στο συμβόλαιο με ένα σύνολο κράτησης/συμβολαίου (transaction), ανάλυση με ΦΠΑ, στοιχεία κάρτας μόνο για αναγνώριση, αναζήτηση `searchText` + GIN trigram, σελιδοποίηση, migration `12` |
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
```
