import type { NextConfig } from "next";
import { normalizeBasePath } from "./src/lib/base-path";

const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

const commonSecurityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const apiSecurityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "default-src 'none'; frame-ancestors 'none'",
  },
];

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: commonSecurityHeaders,
      },
      {
        source: "/api/:path*",
        headers: apiSecurityHeaders,
      },
    ];
  },
};

export default nextConfig;
