# FleetPro v2 — Handoff

**Ημερομηνία:** 29/09/2026 · **Commit:** βλ. §9 (εκπτώσεις συνδρομών) · **Κατάσταση:** commit τοπικά, **όχι pushed** — περιμένει να τρέξει το `09` στο Supabase

> **Επόμενο βήμα:** ο Giannis τρέχει το `prisma/sql/09-platform-discounts.sql` στο Supabase (verification `1 | 1 | 9 | 1 | 3`) και μετά λέει «push». Έπειτα, επόμενη σελίδα από το roadmap (§8).

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
| `DATABASE_URL` | Σύνδεση Supabase PostgreSQL | Vercel + `.env.local` |
| `JWT_SECRET` | Υπογραφή JWT (≥32 χαρακτήρες· χωρίς αυτό η εφαρμογή σταματά) | Vercel + `.env.local` |
| `SUPER_ADMIN_EMAIL` | Λογαριασμός πλατφόρμας | Vercel |
| `SUPER_ADMIN_PASSWORD` | Λογαριασμός πλατφόρμας | Vercel |

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

**Σημειώσεις λογικής:**
- ΦΠΑ **inclusive**: το `Booking.total` περιέχει ΦΠΑ. `net = total / (1 + ΦΠΑ/100)`. Το ποσοστό γίνεται snapshot στο τιμολόγιο.
- Αρίθμηση τιμολογίων `INV-001…` ανά tenant, ασφαλής σε ταυτόχρονη έκδοση.
- Προμήθεια: **δυναμική** (δεν παγώνει), πάνω σε ενοίκιο/πρόσθετα/ασφάλεια κατ' επιλογή, **πριν** την έκπτωση. Οι ακυρωμένες δεν μετράνε.
- `partnerId` = ποιος **έφερε** την κράτηση · `createdById` = ποιος την **κατέγραψε**.
- Εκπτώσεις συνδρομών (Super Admin): ποσοστό ή σταθερό €/μήνα σε **μία** εταιρία, `validFrom` → `validUntil` (κενό = μέχρι διακοπής) + `active`. **Μία ενεργή ανά εταιρία** σε επικαλυπτόμενο διάστημα (409). Οι τιμές πλάνων (`PLAN_PRICES`) ζουν πλέον στο `src/lib/platformDiscounts.ts` — το Tenant αποθηκεύει μόνο το πλάνο. **Μόνο αποθήκευση/εμφάνιση**, καμία χρέωση· το Stripe θα τις διαβάσει αργότερα. Το παλιό `PlatformCoupon` (κουπόνια με κωδικό) μένει αχρησιμοποίητο.

## 6. Migrations

Στο `prisma/sql/`, με σειρά: `01-schema` → `01b-locale` → `02b-extras-rentalmode` → `03-booking-times` → `04-round-up-total` → `05-invoices` → `06-permissions` → `07-partner-commission` → `08-service-damages` → `09-platform-discounts`. Το `02-seed` τρέχει οποτεδήποτε μετά το `01-schema`.

- **01 → 07: έχουν τρέξει** (κάθε ένα προηγήθηκε του αντίστοιχου push).
- **08-service-damages:** το push του `46fda54` έγινε μετά από ρητό «push», άρα κατά πάσα πιθανότητα έτρεξε. **Αξίζει επιβεβαίωση** με το verification SELECT του αρχείου (αναμενόμενο `1 | 4 | 1 | 1 | 2 | 0`). Αν δεν έχει τρέξει, η σελίδα Service & Ζημιές και ο Πίνακας σκάνε.
- **09-platform-discounts: ΔΕΝ έχει τρέξει ακόμα.** Πρέπει να τρέξει **πριν** το push (αναμενόμενο verification `1 | 1 | 9 | 1 | 3`). Αν δεν τρέξει, σκάει μόνο το tab «Εκπτώσεις» του `/super-admin`.

Έλεγχος συμφωνίας schema ↔ βάση:
`npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` → πρέπει να λέει «This is an empty migration.»

## 7. Εκκρεμότητες

| Σοβαρότητα | Θέμα |
|---|---|
| 🔴 Υψηλή | **Κωδικός Super Admin σε 3 αρχεία** (`SETUP.md`, `prisma/seed.ts`, `prisma/sql/02-seed.sql`) σε καθαρή μορφή. Πρέπει να αφαιρεθεί από το repo. |
| 🔴 Υψηλή | **Rotate** κωδικού Supabase DB και `JWT_SECRET` — παλιές τιμές υπάρχουν στο git history. |
| ✅ Ολοκληρώθηκε | ~~Εκπτώσεις Super Admin ήταν MOCK~~ → πραγματικές εκπτώσεις συνδρομών (βλ. §5). Απομένει μόνο η σύνδεση με Stripe (§8.7). Ξεχωριστές από τις εκπτώσεις κρατήσεων του `/dashboard/discounts`. |
| 🟠 Μεσαία | Το `09-platform-discounts` να τρέξει στο Supabase πριν το push (§6). |
| 🟡 Χαμηλή | Το `08` να επιβεβαιωθεί ότι έτρεξε (§6). |

## 8. Roadmap

Ανενεργά στο sidebar (τα permission keys υπάρχουν ήδη στο registry, χωρίς enforcement):

1. **Συμβόλαια** — `contracts.*`. Υπάρχουν ήδη `Contract`/`ContractTemplate` στο schema και `invoiceIssueTrigger = ON_CONTRACT` περιμένει.
2. **Οικονομικά** — `finance.*`. Υπάρχει μοντέλο `Expense`.
3. **Αναφορές** — `reports.*`.
4. **Τιμολόγια: email** — το `invoiceSendMode = AUTO` και το πεδίο `Invoice.sentAt` υπάρχουν, η αποστολή όχι.
5. **Τιμολόγια: PDF** — σήμερα μόνο εκτύπωση από browser.
6. **Φωτογραφίες ζημιών** — τα πεδία `photos[]` / `documents[]` υπάρχουν, θέλουν Cloudinary.
7. **Billing / Stripe** — συνδρομές εταιριών. Οι εκπτώσεις συνδρομών (`PlatformDiscount`) υπάρχουν ήδη· το billing θα εφαρμόζει την ενεργή με `platformDiscountStatus` + `discountedPrice`.
8. **Δημόσιο site κρατήσεων** — το `/api/discounts/validate` είναι ήδη ανοιχτό γι' αυτό.

## 9. Changelog

| Commit | Τι |
|---|---|
| _(αυτό το commit)_ | Εκπτώσεις συνδρομών Super Admin: `PlatformDiscount`, API `/api/super-admin/platform-discounts`, αντικατάσταση mock, migration `09` |
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
