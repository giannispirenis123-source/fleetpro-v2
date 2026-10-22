// src/middleware.ts
// Auth middleware — προστασία routes + tenant routing

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { PUBLIC_CONTRACT_PATH_RE } from "@/lib/contractLink";
import { SITE_LANG_HEADER } from "@/lib/storefront/lang";
import { canonicalSitePath } from "@/lib/storefront/slug";
import {
  isPlatformHost,
  platformHostsFromEnv,
  platformOrigin,
  readPlatformEnv,
  requestHost,
  routeCustomDomain,
  siteResponseHeaders,
  SITE_HOST_HEADER,
} from "@/lib/storefront/domain";

// Routes που δεν χρειάζονται auth
const PUBLIC_ROUTES = ["/login", "/api/auth/login"];

// Routes μόνο για Super Admin
const SUPER_ADMIN_ROUTES = ["/super-admin"];

// Routes για Company Admin+
// (Τα Οικονομικά ΔΕΝ είναι εδώ: τα φυλάει το δικαίωμα finance.view μέσω
// pageGuard/withPermission, όχι ο ρόλος.)
const ADMIN_ROUTES = [
  "/dashboard/settings",
  "/dashboard/users",
];

// Η σελίδα πελάτη /c/<token>: ΜΟΝΟ αυτή η διαδρομή (ακριβώς ένα τμήμα,
// χαρακτήρες base64url) είναι ελεύθερη χωρίς login — ο ΙΔΙΟΣ έλεγχος με το
// link που φτιάχνει η εφαρμογή (contractLink.ts).
const PUBLIC_CONTRACT_RE = PUBLIC_CONTRACT_PATH_RE;

// Επιστροφή από το Stripe μετά την πληρωμή του συμβολαίου: στατικό «ευχαριστώ»
// χωρίς κανένα στοιχείο (ο πελάτης δεν έχει login). Δεν επιβεβαιώνει τίποτα.
const PUBLIC_PAY_RE = /^\/pay\/(done|cancelled)\/?$/;

/** Headers αιτήματος προς τις σελίδες του site: γλώσσα + (μόνο εδώ) host του domain. */
function siteRequestHeaders(req: NextRequest, internalPath: string, siteHost: string | null): Headers {
  const headers = new Headers(req.headers);
  const lang = internalPath.split("/")[3] ?? "";
  if (/^[a-z]{2}$/.test(lang)) headers.set(SITE_LANG_HEADER, lang);
  else headers.delete(SITE_LANG_HEADER);
  // ΠΟΤΕ από τον επισκέπτη: σβήνεται πάντα και μπαίνει ΜΟΝΟ το καθαρό host.
  headers.delete(SITE_HOST_HEADER);
  if (siteHost) headers.set(SITE_HOST_HEADER, siteHost);
  return headers;
}

function withSiteHeaders(res: NextResponse, internalPath: string): NextResponse {
  for (const [k, v] of siteResponseHeaders(internalPath)) res.headers.set(k, v);
  return res;
}

const domainNotFound = () =>
  new NextResponse("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
  });

/**
 * Αίτημα σε domain εταιρίας (όχι host της πλατφόρμας): ΜΟΝΟ το site. Ποια
 * εταιρία το κρίνει ΜΟΝΟ το resolveStorefrontByHost (VERIFIED) — αλλιώς 404.
 */
function customDomainResponse(req: NextRequest, host: string): NextResponse {
  const route = routeCustomDomain(req.nextUrl.pathname);
  switch (route.kind) {
    case "pass": {
      const headers = new Headers(req.headers);
      headers.delete(SITE_HOST_HEADER);
      return NextResponse.next({ request: { headers } });
    }
    case "notFound":
      return domainNotFound();
    case "login": {
      // «Είσοδος» από το domain της εταιρίας → login της πλατφόρμας (ποτέ
      // login/cookie στο domain της εταιρίας). Άγνωστη πλατφόρμα → 404.
      const platform = platformOrigin(readPlatformEnv());
      return platform ? NextResponse.redirect(`${platform}/login`, 307) : domainNotFound();
    }
    case "redirect": {
      const url = req.nextUrl.clone();
      url.pathname = route.path;
      return NextResponse.redirect(url, 308);
    }
    case "rewrite": {
      const url = req.nextUrl.clone();
      url.pathname = route.path;
      const res = NextResponse.rewrite(url, { request: { headers: siteRequestHeaders(req, route.path, host) } });
      return withSiteHeaders(res, route.path);
    }
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Domain εταιρίας; (localhost, IP, *.vercel.app και το PLATFORM_URL είναι
  // πάντα πλατφόρμα — εκεί όλα μένουν όπως πριν.)
  const host = requestHost((n) => req.headers.get(n));
  if (!isPlatformHost(host, platformHostsFromEnv(readPlatformEnv()))) {
    return customDomainResponse(req, host!);
  }

  if (PUBLIC_PAY_RE.test(pathname)) {
    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  }

  if (PUBLIC_CONTRACT_RE.test(pathname)) {
    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.headers.set("Cache-Control", "no-store, max-age=0");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  }

  // Δημόσια σελίδα εταιρίας /s/<slug>/...: χωρίς login. Ποια εταιρία και
  // αν επιτρέπεται (ενεργή σελίδα + πακέτο με publicSite) το κρίνει ΜΟΝΟ το
  // resolveStorefrontCompany (src/lib/storefront/resolve.ts) — αλλιώς 404.
  // Η γλώσσα του URL (/s/<slug>/<lang>/…) περνά στο root layout για το
  // <html lang>. Αναζήτηση και περίληψη κράτησης: noindex (ίδιοι κανόνες με
  // το domain εταιρίας — siteResponseHeaders).
  if (pathname.startsWith("/s/")) {
    // Slug/γλώσσα με κεφαλαία, κενά ή τόνους (π.χ. από το πληκτρολόγιο του
    // κινητού) → η κανονική διεύθυνση, αντί για 404.
    const canonical = canonicalSitePath(pathname);
    if (canonical) {
      const url = req.nextUrl.clone();
      url.pathname = canonical;
      return NextResponse.redirect(url, 308);
    }
    const res = NextResponse.next({ request: { headers: siteRequestHeaders(req, pathname, null) } });
    return withSiteHeaders(res, pathname);
  }

  // Επιτρέπουμε public routes
  if (PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // Επιτρέπουμε API routes (έχουν δικό τους auth)
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Έλεγχος token
  const token = req.cookies.get("fleetpro_token")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const session = await verifyToken(token);

  if (!session) {
    const response = NextResponse.redirect(new URL("/login", req.url));
    response.cookies.delete("fleetpro_token");
    return response;
  }

  // Super Admin only routes
  if (
    SUPER_ADMIN_ROUTES.some((r) => pathname.startsWith(r)) &&
    session.role !== "SUPER_ADMIN"
  ) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Admin only routes
  if (
    ADMIN_ROUTES.some((r) => pathname.startsWith(r)) &&
    session.role === "PARTNER"
  ) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Redirect Super Admin από dashboard στο super-admin
  if (pathname === "/dashboard" && session.role === "SUPER_ADMIN") {
    return NextResponse.redirect(new URL("/super-admin", req.url));
  }

  // Redirect στο login αν δεν είναι Super Admin και πάει σε /super-admin
  if (pathname.startsWith("/super-admin") && session.role !== "SUPER_ADMIN") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg).*)",
  ],
};
