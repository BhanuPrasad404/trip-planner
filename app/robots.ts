import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/trip/", "/trips", "/dashboard", "/explore", "/memories", "/profile", "/join/", "/auth/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
