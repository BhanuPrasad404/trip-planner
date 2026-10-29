import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import { getSiteUrl } from "@/lib/env";
import { RouteProgress } from "@/components/shell/RouteProgress";
import { ErrorReporter } from "@/components/shell/ErrorReporter";
import { MobileBackdrop } from "@/components/shell/MobileBackdrop";
import "./globals.css";

// Fonts are self-hosted (SIL OFL licensed) instead of fetched from Google at build time:
// deterministic builds, no third-party request for visitors, and no dependency on the
// Turbopack `next/font/google` resolver.
const fraunces = localFont({
  src: "./fonts/fraunces-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-fraunces",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
  adjustFontFallback: "Arial",
});

const plexMono = localFont({
  src: "./fonts/ibm-plex-mono-latin-500-normal.woff2",
  weight: "500",
  variable: "--font-plex-mono",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "monospace"],
});

const description =
  "Trailmate is the group trip planner that knows when to go: it flags places that are out of season for your travel dates and orders stops so you stop zig-zagging across the state.";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: "Trailmate — Plan trips that know when to go",
    template: "%s · Trailmate",
  },
  description,
  applicationName: "Trailmate",
  // Installed on an iPhone home screen: opens like an app, with the Trailmate name under the icon (app/apple-icon.tsx).
  // "default": the phone's clock and battery are drawn dark on the warm-white app (black-translucent would draw them white on white).
  appleWebApp: { capable: true, title: "Trailmate", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: "Trailmate",
    title: "Trailmate — Plan trips that know when to go",
    description,
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Trailmate — Plan trips that know when to go",
    description,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The phone's address bar takes the page's own warm white; larger screens keep the brand's deep green.
  themeColor: [{ media: "(max-width: 767px)", color: "#faf8f3" }, { color: "#0b3d3a" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-sky text-ink">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-pine focus:shadow-lg"
        >
          Skip to content
        </a>
        <MobileBackdrop />
        <Suspense fallback={null}><RouteProgress /></Suspense>
        <ErrorReporter />
        {children}
      </body>
    </html>
  );
}
