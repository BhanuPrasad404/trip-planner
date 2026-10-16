import type { MetadataRoute } from "next";
import { PWA_BACKGROUND, PWA_DESCRIPTION, PWA_NAME, PWA_THEME, pwaIconPath } from "@/lib/pwa";

// The web app manifest: lets phones install Trailmate as an app (home-screen icon, opens without the browser bar).
// Public and the same for everyone: no user data. Next.js serves it at /manifest.webmanifest and links it from every page.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: PWA_NAME,
    short_name: PWA_NAME,
    description: PWA_DESCRIPTION,
    lang: "en-IN",
    dir: "ltr",
    start_url: "/dashboard",   // signed-out people are sent to log in first, as with any signed-in page
    scope: "/",
    display: "standalone",
    background_color: PWA_BACKGROUND,
    theme_color: PWA_THEME,
    categories: ["travel", "navigation"],
    icons: [
      { src: pwaIconPath("192"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: pwaIconPath("512"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: pwaIconPath("maskable"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
