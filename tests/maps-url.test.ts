import { describe, expect, it, vi } from "vitest";
import { extractUrls, isGoogleMapsUrl, parseMapsUrl, resolveShortMapsUrl, stripUrls } from "@/lib/maps-url";

describe("parseMapsUrl", () => {
  it("reads name + precise pin from a place URL (pin beats viewport centre)", () => {
    const u = "https://www.google.com/maps/place/Kalu+Waterfall/@18.80,73.40,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d18.7645!4d73.4155";
    expect(parseMapsUrl(u)).toEqual({ lat: 18.7645, lng: 73.4155, name: "Kalu Waterfall" });
  });
  it("reads @lat,lng", () => {
    expect(parseMapsUrl("https://www.google.com/maps/@19.5410,73.7500,12z")).toMatchObject({ lat: 19.541, lng: 73.75 });
  });
  it("reads ?q=lat,lng and url-encoded commas", () => {
    expect(parseMapsUrl("https://maps.google.com/?q=18.7833,73.3833")).toMatchObject({ lat: 18.7833, lng: 73.3833 });
    expect(parseMapsUrl("https://maps.google.com/?q=18.7833%2C73.3833")).toMatchObject({ lat: 18.7833, lng: 73.3833 });
  });
  it("does not treat a coordinate-only place name as a name", () => {
    expect(parseMapsUrl("https://www.google.com/maps/place/18.7645,73.4155/@18.7645,73.4155,17z")?.name).toBeNull();
  });
  it("rejects out-of-range and null-island coordinates, and non-map urls", () => {
    expect(parseMapsUrl("https://www.google.com/maps/@95.0,73.0,12z")).toBeNull();
    expect(parseMapsUrl("https://www.google.com/maps/@0.0,0.0,12z")).toBeNull();
    expect(parseMapsUrl("https://example.com/")).toBeNull();
  });
});

describe("url helpers", () => {
  it("extracts urls and strips trailing punctuation", () => {
    expect(extractUrls("see https://a.com/x, and https://b.com/y.")).toEqual(["https://a.com/x", "https://b.com/y"]);
  });
  it("strips urls from text", () => {
    expect(stripUrls("Kalu falls https://a.com/x amazing")).toBe("Kalu falls amazing");
  });
  it("recognises google maps hosts only", () => {
    expect(isGoogleMapsUrl("https://maps.app.goo.gl/abc")).toBe(true);
    expect(isGoogleMapsUrl("https://www.google.com/maps/place/x")).toBe(true);
    expect(isGoogleMapsUrl("https://www.google.com/search?q=x")).toBe(false);
    expect(isGoogleMapsUrl("https://evil.com/maps/place/x")).toBe(false);
    expect(isGoogleMapsUrl("https://google.com.evil.com/maps/x")).toBe(false);
  });
});

describe("resolveShortMapsUrl (SSRF-safe)", () => {
  const redirect = (loc: string) => ({ headers: new Headers({ location: loc }) }) as Response;

  it("follows allowlisted redirects to a URL with coordinates", async () => {
    const f = vi.fn().mockResolvedValueOnce(redirect("https://www.google.com/maps/place/X/@18.1,73.2,15z"));
    const out = await resolveShortMapsUrl("https://maps.app.goo.gl/abc", f as unknown as typeof fetch);
    expect(out).toContain("@18.1,73.2");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("NEVER fetches a non-allowlisted host, even via redirect", async () => {
    const f = vi.fn().mockResolvedValueOnce(redirect("http://169.254.169.254/latest/meta-data"));
    const out = await resolveShortMapsUrl("https://maps.app.goo.gl/abc", f as unknown as typeof fetch);
    expect(out).toBeNull();
    expect(f).toHaveBeenCalledTimes(1); // only the first, allowlisted hop
  });
  it("refuses non-https and arbitrary starting hosts", async () => {
    const f = vi.fn();
    expect(await resolveShortMapsUrl("http://maps.app.goo.gl/abc", f as unknown as typeof fetch)).toBeNull();
    expect(await resolveShortMapsUrl("https://internal.local/x", f as unknown as typeof fetch)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("stops on redirect loops", async () => {
    const f = vi.fn().mockResolvedValue(redirect("https://maps.app.goo.gl/loop"));
    expect(await resolveShortMapsUrl("https://maps.app.goo.gl/loop", f as unknown as typeof fetch)).toBeNull();
    expect(f.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
