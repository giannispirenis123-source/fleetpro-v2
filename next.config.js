/** @type {import('next').NextConfig} */

// Security headers (audit 10/2026). Σε ΟΛΕΣ τις σελίδες: nosniff, Referrer-Policy,
// HSTS, Permissions-Policy (κάμερα μόνο για το ίδιο site — φωτογραφίες).
// Απαγόρευση iframe (clickjacking) σε ΟΛΑ εκτός από το δημόσιο site /s/*, που
// μπορεί να ενσωματώνεται στο site μιας εταιρίας.
const COMMON = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];
const NO_FRAMES = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig = {
  // src/instrumentation.ts: έλεγχος ρυθμίσεων Storage στην εκκίνηση.
  experimental: { instrumentationHook: true },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
  },
  async headers() {
    return [
      { source: "/:path*", headers: COMMON },
      // Όλα εκτός από /s/* (δημόσιο site).
      { source: "/((?!s/).*)", headers: NO_FRAMES },
    ];
  },
};

module.exports = nextConfig;
