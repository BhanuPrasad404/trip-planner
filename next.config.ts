import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Pin the workspace root so a stray lockfile in a parent folder
  // (e.g. C:\Users\you\Desktop\package-lock.json) can't confuse Turbopack.
  turbopack: { root: process.cwd() },
  // The opening screen's hills picture is drawn at quality 70; Next only allows the qualities listed here (it warned on every load).
  images: { qualities: [70, 75] },
  // The India place-name index (GeoNames) is read from disk at run time by these routes, so it must ship with them.
  outputFileTracingIncludes: {
    "/api/place-search": ["./data/geo/**/*"],
    "/api/place-here": ["./data/geo/**/*"],
    "/api/place-suggest": ["./data/geo/**/*"],
    "/api/intake/read": ["./data/geo/**/*"],
    "/api/intake/ai": ["./data/geo/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
