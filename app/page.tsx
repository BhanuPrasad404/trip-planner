import { SiteHeader } from "@/components/SiteHeader";
import { LandingBody } from "@/components/landing/LandingBody";
import { getSiteUrl } from "@/lib/env";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Trailmate",
  applicationCategory: "TravelApplication",
  description: "Season-aware group trip planner for India.",
  url: getSiteUrl(),
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader tone="ink" />
      <LandingBody />
    </>
  );
}
