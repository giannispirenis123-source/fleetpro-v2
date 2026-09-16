// src/app/api/dbcheck/route.ts
// ⚠️ ΠΡΟΣΩΡΙΝΟ ΔΙΑΓΝΩΣΤΙΚΟ — ΝΑ ΔΙΑΓΡΑΦΕΙ ΜΕΤΑ ΤΗ ΧΡΗΣΗ
//
// Ελέγχει, με τη σειρά, τις προϋποθέσεις που χρειάζεται το /api/auth/login
// και δείχνει σε ποια ακριβώς σπάει. Μόνο ανάγνωση — δεν γράφει στη βάση,
// δεν ελέγχει κωδικούς χρηστών, δεν εμφανίζει ποτέ τιμές μεταβλητών.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signToken } from "@/lib/auth";

const ACCESS_KEY = "WHWNrjjzzzS3v4RkoeqSUW7AuFkjE-BV";

type Step = { name: string; ok: boolean; detail: string };

// Αφαιρεί τυχόν credentials από κείμενο σφάλματος πριν εμφανιστεί
function scrub(text: string): string {
  return text
    .replace(/:\/\/[^@\s]+@/g, "://***:***@")
    .replace(/password=[^\s&"']+/gi, "password=***");
}

function describeUrl(raw: string | undefined): string {
  if (!raw) return "δεν έχει οριστεί";
  try {
    const u = new URL(raw);
    const port = u.port || "(προεπιλογή 5432)";
    const pooled = u.searchParams.get("pgbouncer") === "true";
    const hostTail = u.hostname.split(".").slice(-3).join(".");
    return `θύρα ${port} · host …${hostTail} · pgbouncer=${pooled ? "true" : "ΟΧΙ"}`;
  } catch {
    return "δεν διαβάζεται ως έγκυρο URL";
  }
}

function asDetail(e: unknown): string {
  const err = e as Error & { code?: string };
  return scrub(`${err.name}${err.code ? ` [${err.code}]` : ""}: ${err.message}`);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== ACCESS_KEY) {
    return new NextResponse("Not found", { status: 404 });
  }

  const steps: Step[] = [];

  // 1. Environment variables — μόνο παρουσία και μήκος, ποτέ η τιμή
  for (const name of ["DATABASE_URL", "DIRECT_URL", "JWT_SECRET"]) {
    const v = process.env[name];
    steps.push({
      name: `env ${name}`,
      ok: Boolean(v),
      detail: v ? `υπάρχει (${v.length} χαρακτήρες)` : "ΛΕΙΠΕΙ",
    });
  }

  // Προαιρετικό: δεν εμποδίζει το login, οπότε δεν μετράει ως αποτυχία
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  steps.push({
    name: "env NEXT_PUBLIC_APP_URL",
    ok: true,
    detail: appUrl ? `υπάρχει (${appUrl.length} χαρακτήρες)` : "λείπει — προαιρετικό, δεν επηρεάζει το login",
  });

  // 2. Μορφή του DATABASE_URL — θύρα και pgbouncer, χωρίς credentials
  steps.push({
    name: "μορφή DATABASE_URL",
    ok: Boolean(process.env.DATABASE_URL),
    detail: describeUrl(process.env.DATABASE_URL),
  });

  // 3. Σύνδεση στη βάση
  let dbUp = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbUp = true;
    steps.push({ name: "σύνδεση στη βάση", ok: true, detail: "OK" });
  } catch (e) {
    steps.push({ name: "σύνδεση στη βάση", ok: false, detail: asDetail(e) });
  }

  // 4. Οι πίνακες που χρειάζεται το login (μόνο πλήθη, κανένα προσωπικό δεδομένο)
  if (dbUp) {
    try {
      const users = await db.user.count();
      steps.push({ name: "πίνακας users", ok: users > 0, detail: `${users} εγγραφές` });

      const tenants = await db.tenant.count();
      steps.push({ name: "πίνακας tenants", ok: true, detail: `${tenants} εγγραφές` });
    } catch (e) {
      steps.push({ name: "ανάγνωση πινάκων", ok: false, detail: asDetail(e) });
    }
  }

  // 5. Δημιουργία JWT — εδώ φαίνεται αν λείπει ή είναι άκυρο το JWT_SECRET
  try {
    await signToken({
      userId: "dbcheck",
      email: "dbcheck@local",
      role: "SUPER_ADMIN",
      tenantId: null,
      tenantSlug: null,
      name: "dbcheck",
    });
    steps.push({ name: "δημιουργία JWT", ok: true, detail: "OK" });
  } catch (e) {
    steps.push({ name: "δημιουργία JWT", ok: false, detail: asDetail(e) });
  }

  const failed = steps.filter((s) => !s.ok);
  const verdict =
    failed.length === 0
      ? "Όλα τα βήματα πέρασαν — το login θα έπρεπε να δουλεύει."
      : `Πρώτο πρόβλημα: ${failed[0].name} → ${failed[0].detail}`;

  const plain = steps.map((s) => `${s.ok ? "OK  " : "FAIL"} | ${s.name}: ${s.detail}`).join("\n");
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = `<!doctype html><html lang="el"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FleetPro — Έλεγχος βάσης</title>
<style>
  body{margin:0;padding:16px;background:#0a0a0f;color:#e2e8f0;
       font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  h1{font-size:19px;margin:0 0 4px}
  .sub{color:#64748b;font-size:13px;margin-bottom:18px}
  .verdict{padding:12px 14px;border-radius:10px;margin-bottom:18px;font-weight:600;
           background:${failed.length ? "#2a1015" : "#0d2018"};
           border:1px solid ${failed.length ? "#7f1d1d" : "#166534"};
           color:${failed.length ? "#fca5a5" : "#86efac"}}
  .row{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #1e1e2e;align-items:flex-start}
  .ico{flex:none;width:18px}
  .nm{font-weight:600;font-size:14px}
  .dt{color:#94a3b8;font-size:13px;word-break:break-word;margin-top:2px}
  pre{background:#0f0f1a;border:1px solid #1e1e2e;border-radius:10px;padding:12px;
      overflow-x:auto;font-size:12px;color:#cbd5e1;margin-top:18px;
      white-space:pre-wrap;word-break:break-word}
  .warn{margin-top:18px;padding:10px 12px;border-radius:8px;background:#1a1505;
        border:1px solid #78350f;color:#fcd34d;font-size:13px}
</style></head><body>
<h1>Έλεγχος σύνδεσης βάσης</h1>
<div class="sub">Οι προϋποθέσεις του login, μία προς μία.</div>
<div class="verdict">${esc(verdict)}</div>
${steps
  .map(
    (s) => `<div class="row"><div class="ico">${s.ok ? "✅" : "❌"}</div>
<div><div class="nm">${esc(s.name)}</div><div class="dt">${esc(s.detail)}</div></div></div>`
  )
  .join("")}
<pre>${esc(plain)}</pre>
<div class="warn">⚠️ Προσωρινή σελίδα διάγνωσης. Διέγραψέ την μόλις λυθεί το πρόβλημα.</div>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
