import { describe, expect, it, vi } from "vitest";
import { openMeteoElevation } from "@/lib/providers/elevation-open-meteo";

const pts = [{ lat: 17.38, lng: 78.48 }, { lat: 17.51, lng: 78.88 }];
const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe("Open-Meteo elevation provider", () => {
  it("asks once for all points, with coordinates in order, and returns heights in order", async () => {
    const f = ok({ elevation: [542, 441] });
    expect(await openMeteoElevation.elevations(pts, f)).toEqual([542, 441]);
    const [url] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain("https://api.open-meteo.com/v1/elevation"); expect(url).toContain("latitude=17.38000,17.51000"); expect(url).toContain("longitude=78.48000,78.88000");
  });
  it("a point it has no value for becomes null, never a made-up number", async () => {
    expect(await openMeteoElevation.elevations(pts, ok({ elevation: [542, null] }))).toEqual([542, null]);
    expect(await openMeteoElevation.elevations(pts, ok({ elevation: ["x", NaN] }))).toEqual([null, null]);
  });
  it("an outage or a malformed answer is an error (the caller says 'unavailable'), not silence", async () => {
    await expect(openMeteoElevation.elevations(pts, vi.fn(async () => new Response("no", { status: 503 })) as unknown as typeof fetch)).rejects.toThrow("HTTP 503");
    await expect(openMeteoElevation.elevations(pts, ok({ elevation: [1] }))).rejects.toThrow("unexpected");
    await expect(openMeteoElevation.elevations(pts, ok({}))).rejects.toThrow("unexpected");
    await expect(openMeteoElevation.elevations(pts, vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch)).rejects.toThrow("offline");
  });
  it("respects its own limits: no points means no request; too many is refused", async () => {
    const f = ok({ elevation: [] });
    expect(await openMeteoElevation.elevations([], f)).toEqual([]); expect(f).not.toHaveBeenCalled();
    await expect(openMeteoElevation.elevations(Array.from({ length: 101 }, () => pts[0]), f)).rejects.toThrow("at most 100");
    expect(openMeteoElevation.maxPoints).toBe(100);
  });
  it("is the registered default and can be swapped by name", async () => {
    const { getProvider } = await import("@/lib/providers/registry");
    expect(getProvider("elevation", {}).id).toBe("open-meteo");
    expect(() => getProvider("elevation", { ELEVATION_PROVIDER: "nope" })).toThrow("Unknown elevation provider");
  });
});
