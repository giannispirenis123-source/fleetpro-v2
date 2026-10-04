/** @type {import('next').NextConfig} */
const nextConfig = {
  // src/instrumentation.ts: έλεγχος ρυθμίσεων Storage στην εκκίνηση.
  experimental: { instrumentationHook: true },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
  },
};

module.exports = nextConfig;
