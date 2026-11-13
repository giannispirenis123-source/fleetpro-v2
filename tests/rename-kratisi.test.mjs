// tests/rename-kratisi.test.mjs — το προϊόν λέγεται «Kratisi» σε ό,τι βλέπει ο
// χρήστης. Τα εσωτερικά ονόματα (cookie fleetpro_token, bucket, φάκελοι,
// idempotency keys, Stripe coupon id, header) μένουν ΙΔΙΑ — αλλαγή τους θα
// έσπαγε συνεδρίες/αρχεία/Stripe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** Μόνο τα string literals (χωρίς σχόλια) — εκεί είναι ό,τι βλέπει ο χρήστης. */
const strings = (src) =>
  (src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").match(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g) ?? []).join("\n");

const USER_FACING = [
  "src/lib/i18n/el.ts",
  "src/lib/i18n/en.ts",
  "src/lib/storefront/i18n.ts",
  "src/lib/billing/core.ts",
  "src/lib/signup/signup.ts",
  "src/lib/invoiceDocument.ts",
  "src/lib/invoicePdf.ts",
  "src/lib/contractPdf.ts",
  "src/app/layout.tsx",
  "src/app/pay/[result]/page.tsx",
  "src/app/(auth)/login/LoginClient.tsx",
  "src/app/(auth)/signup/page.tsx",
  "src/app/(auth)/signup/SignupClient.tsx",
  "src/app/(auth)/verify-email/page.tsx",
  "src/app/(auth)/verify-email/VerifyClient.tsx",
  "src/app/(auth)/legal/LegalPlaceholder.tsx",
  "src/app/(auth)/legal/terms/page.tsx",
  "src/app/(auth)/legal/privacy/page.tsx",
  "src/app/(dashboard)/dashboard/DashboardSidebar.tsx",
  "src/app/(super-admin)/super-admin/page.tsx",
];

test("κανένα «FleetPro / Fleet-Pro / Fleet Pro» σε κείμενο προς τον χρήστη (εκτός από email/URL/όνομα project)", () => {
  for (const f of USER_FACING) {
    const s = strings(read(f))
      .replace(/[\w.+-]+@fleetpro\.gr/gi, "") // διευθύνσεις email (δεν αλλάζουν)
      .replace(/fleetpro-app/g, "") // όνομα project στο Vercel
      .replace(/fleetpro-not-a-password/g, "");
    assert.doesNotMatch(s, /fleet[\s_-]?pro/i, f);
  }
  // Και σε JSX κείμενο (εκτός string literals): λογότυπα/headers.
  for (const f of ["src/app/(auth)/login/LoginClient.tsx", "src/app/(dashboard)/dashboard/DashboardSidebar.tsx", "src/app/(super-admin)/super-admin/page.tsx"]) {
    assert.doesNotMatch(read(f).replace(/[\w.+-]+@fleetpro\.gr/gi, ""), />\s*(?:<[^>]+>\s*)*FleetPro\s*</, f);
  }
});

test("Kratisi: τίτλος, emails, PDF, site", () => {
  assert.match(read("src/app/layout.tsx"), /title: "Kratisi — Διαχείριση Στόλου Οχημάτων"/);
  assert.match(read("src/lib/i18n/el.ts"), /appName: "Kratisi"/);
  assert.match(read("src/lib/i18n/en.ts"), /appName: "Kratisi"/);
  assert.match(read("src/lib/signup/signup.ts"), /"Επιβεβαιώστε το email σας — Kratisi"/);
  assert.match(read("src/lib/billing/core.ts"), /— Kratisi"/);
  assert.match(read("src/lib/invoicePdf.ts"), /setProducer\("Kratisi"\)/);
  assert.match(read("src/lib/contractPdf.ts"), /setProducer\("Kratisi"\)/);
  assert.match(read("src/lib/storefront/i18n.ts"), /poweredBy: "Powered by Kratisi"/);
});

test("εσωτερικά ονόματα ΑΜΕΤΑΒΛΗΤΑ (συνεδρίες, αρχεία, Stripe)", () => {
  assert.match(read("src/lib/sessionCookie.ts"), /SESSION_COOKIE = "fleetpro_token"/);
  assert.match(read("src/lib/storage.ts"), /STORAGE_BUCKET = "fleetpro-files"/);
  assert.match(read("src/lib/vehiclePhotos.ts"), /`fleetpro\/\$\{companyId\}\/vehicles\/\$\{vehicleId\}`/);
  assert.match(read("src/lib/billing/billingServer.ts"), /FOUNDER_COUPON_ID = "fleetpro-founder-50"/);
  assert.match(read("src/lib/public/paymentServer.ts"), /idempotencyKey: `fleetpro-checkout-\$\{b\.id\}`/);
  assert.match(read("package.json"), /"name": "fleetpro-v2"/);
});
