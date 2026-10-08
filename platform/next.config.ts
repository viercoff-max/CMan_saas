import type { NextConfig } from "next";

// Security headers for every route (REVIEW-security L3). No Content-Security-Policy yet: Next injects inline
// scripts for hydration, so a strict CSP needs per-request nonces (proxy.ts) and a real browser test; `frame-ancestors`
// is covered by X-Frame-Options DENY for now.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
