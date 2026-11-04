// The landing page's claims are true of the product, and its photos are only ever the verified, credited kind.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }));
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));
import { CATALOGUE_PLACES, DESTINATIONS, FAQ, FEATURES, KIND_STRIP, RESEARCHED_PLACES, STATS, STEPS, TRUST } from "@/lib/landing-content";
import { EXPLORE_CATEGORIES } from "@/lib/explore/categories";
import { REGIONS } from "@/lib/explore/regions";
import LandingPage from "@/app/page";

describe("the numbers on the landing page are the product's own", () => {
  it("regions and kinds of place are read from the code, not typed", () => {
    expect(STATS.find((s) => s.label.startsWith("states"))!.to).toBe(REGIONS.length);
    expect(STATS.find((s) => s.label.startsWith("kinds"))!.to).toBe(EXPLORE_CATEGORIES.length);
    expect(KIND_STRIP).toHaveLength(EXPLORE_CATEGORIES.length);
    expect(REGIONS.length).toBe(36);
  });
  it("the place count is rounded DOWN from what the catalogue holds (87,997), never above it", () => { expect(CATALOGUE_PLACES).toBeLessThanOrEqual(87_997); expect(CATALOGUE_PLACES).toBeGreaterThan(80_000); });
  it("researched places are counted from the season data", () => { expect(RESEARCHED_PLACES).toBeGreaterThan(0); expect(FAQ.some((f) => f.a.includes(String(RESEARCHED_PLACES)))).toBe(true); });
  it("no invented social proof anywhere: no ratings, reviews, user counts or testimonials", () => {
    const all = JSON.stringify([FEATURES, STEPS, TRUST, FAQ, STATS]);
    for (const word of ["★", "stars", "5-star", "reviews", "testimonial", "million users", "travellers trust", "#1", "award"]) expect(all.toLowerCase()).not.toContain(word.toLowerCase());
  });
});

describe("the page", () => {
  const html = renderToStaticMarkup(LandingPage() as never);
  it("has every section a visitor scrolls through, in order", () => {
    const order = ["hero-heading", "Trailmate in numbers", "Kinds of places", "places-heading", "when-heading", "features-heading", "how-heading", "trust-heading", "faq-heading", "cta-heading"].map((id) => html.indexOf(id));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("shows the real numbers, every destination by name, every FAQ question and the way in", () => {
    expect(html).toContain("87,000+"); expect(html).toContain("36");
    for (const d of DESTINATIONS) expect(html).toContain(d.name);
    for (const f of FAQ) expect(html).toContain(f.q.replace(/'/g, "&#x27;"));
    expect(html).toContain('href="/signup"'); expect(html).toContain('href="/login"');
  });
  it("is fully visible with no script: content is never hidden by the server render", () => {
    expect(html).not.toContain('data-armed="true"'); expect(html).not.toContain("opacity:0");
  });
  it("credits its photos and names its data sources", () => { expect(html).toContain("each credited to its author"); expect(html).toContain("OpenStreetMap contributors"); });
  it("the marquee's repeated half is hidden from screen readers", () => { expect((html.match(/aria-hidden="true" class="inline-flex shrink-0/g) ?? []).length).toBe(KIND_STRIP.length); });
  it("uses the live-companion header as it really is (an example, with no invented distances or times)", () => {
    expect(html).toContain("Example screen"); const demo = html.slice(html.indexOf("Example screen") - 3000, html.indexOf("Example screen"));
    expect(demo).not.toMatch(/\d\s?km\b/); expect(demo).not.toMatch(/\b\d{1,2}:\d{2}\s?(AM|PM)\b/);
  });
});
