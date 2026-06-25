# 🚀 FleetPro v2 — Οδηγός Εγκατάστασης

## Τι περιλαμβάνει αυτό το παρεδόθη

### 📁 Αρχεία που δημιουργήθηκαν

```
fleetpro/
├── prisma/
│   ├── schema.prisma          ← Πλήρες multi-tenant schema
│   └── seed.ts                ← Demo δεδομένα + Super Admin
├── src/
│   ├── app/
│   │   ├── (auth)/login/      ← Σελίδα σύνδεσης
│   │   ├── (super-admin)/     ← Super Admin Dashboard
│   │   ├── api/
│   │   │   ├── auth/          ← Login, Logout, Me
│   │   │   ├── tenants/       ← CRUD εταιριών
│   │   │   ├── users/         ← CRUD χρηστών με permissions
│   │   │   └── discounts/     ← Σύστημα εκπτώσεων + validate
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── lib/
│   │   ├── auth.ts            ← JWT utilities
│   │   ├── db.ts              ← Prisma singleton
│   │   └── api.ts             ← Response helpers + middleware
│   └── middleware.ts          ← Auth + tenant routing
├── package.json
├── next.config.js
├── tsconfig.json
├── tailwind.config.ts
└── .env.example
```

---

## ⚡ Βήματα Εγκατάστασης

### 1. Δημιουργία project στο Replit (από Android)

1. Άνοιξε το **replit.com** από Chrome
2. Πάτα **+ Create Repl**
3. Επίλεξε **Node.js** template
4. Όνομα: `fleetpro-v2`

### 2. Αντιγραφή αρχείων

Αντέγραψε κάθε αρχείο στη σωστή θέση στο Replit file explorer.

### 3. Ρύθμιση Database (Supabase - δωρεάν)

1. Πήγαινε στο **supabase.com** → New Project
2. Δημιούργησε project `fleetpro`
3. Αντέγραψε το **Connection String** από Settings → Database
4. Βάλ' το στο `.env.local` ως `DATABASE_URL`

### 4. Ρύθμιση Environment Variables

Στο Replit → **Secrets** (🔒 εικονίδιο), πρόσθεσε:

```
DATABASE_URL = postgresql://...
JWT_SECRET = any-random-32-char-string-here-123
NEXT_PUBLIC_APP_URL = https://your-repl.replit.app
```

### 5. Εγκατάσταση & Εκτέλεση

Στο Replit Shell:
```bash
npm install
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

### 6. Σύνδεση

Άνοιξε το URL του Replit και σύνδεσου με:
- **Super Admin**: `superadmin@fleetpro.gr` / `FleetPro2025!`
- **Company Admin**: `admin@prentals.gr` / `Admin2025!`

---

## 🏗️ Τι Κατασκευάστηκε — Αρχιτεκτονική

### 3 Επίπεδα Χρηστών

```
Super Admin (Platform Owner)
  ↓ διαχειρίζεται
Tenant (Εταιρία) ← Company Admin
  ↓ έχει
Users (Staff / Partner) ← ορισμένα δικαιώματα
```

### Multi-Tenant Απομόνωση

- Κάθε εταιρία έχει `tenant_id` σε όλα τα δεδομένα
- API middleware ελέγχει `tenantId` σε κάθε request
- Αδύνατο να δει μια εταιρία δεδομένα άλλης

### JWT Authentication

- Token αποθηκεύεται ως HTTP-only cookie
- Payload: `userId, email, role, tenantId, tenantSlug`
- Λήγει σε 7 ημέρες

---

## 📦 Επόμενα Βήματα (Phase 2)

Αυτό που κατασκευάστηκε είναι το **Foundation**. Επόμενα:

1. **Company Admin Dashboard** — το κύριο dashboard
2. **Vehicles API + UI** — διαχείριση στόλου
3. **Bookings API + UI** — κρατήσεις με discount engine
4. **Contracts** — ενσωμάτωση υπάρχοντος συμβολαίου
5. **Public Booking Site** — branded σελίδα ανά tenant
6. **Stripe Integration** — συνδρομές

---

## 🗄️ Prisma Schema Highlights

### Multi-Tenancy
```prisma
// Κάθε model έχει tenantId
model Vehicle {
  tenantId  String
  tenant    Tenant @relation(...)
  // ...
}
```

### Granular Permissions
```prisma
model User {
  permissions Json @default("{}")
  // {viewBookings: true, manageContracts: false, ...}
}
```

### Discount Engine
```prisma
model Discount {
  code      String?      // κωδικός ή αυτόματο
  type      DiscountType // PERCENTAGE | FIXED_AMOUNT
  target    DiscountTarget // ALL | CATEGORY | VEHICLE | CUSTOMER
  isLoyalty Boolean      // αυτόματο για VIP πελάτες
  isSeasonal Boolean     // εποχικό
}
```

---

## 🔐 API Routes

| Method | Route | Auth | Περιγραφή |
|--------|-------|------|-----------|
| POST | `/api/auth/login` | Public | Σύνδεση |
| POST | `/api/auth/logout` | Auth | Αποσύνδεση |
| GET | `/api/auth/me` | Auth | Τρέχων χρήστης |
| GET | `/api/tenants` | Super Admin | Λίστα εταιριών |
| POST | `/api/tenants` | Super Admin | Νέα εταιρία |
| PATCH | `/api/tenants/[id]` | Super Admin | Ενημέρωση |
| DELETE | `/api/tenants/[id]` | Super Admin | Διαγραφή |
| GET | `/api/users` | Admin+ | Λίστα χρηστών |
| POST | `/api/users` | Admin+ | Νέος χρήστης |
| GET | `/api/discounts` | Auth | Εκπτώσεις tenant |
| POST | `/api/discounts` | Admin | Νέα έκπτωση |
| POST | `/api/discounts/validate` | Public | Επαλήθευση κωδικού |

---

*FleetPro v2 — Κατασκευάστηκε με Next.js 14 + PostgreSQL + Prisma*
