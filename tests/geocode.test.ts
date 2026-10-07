import { afterEach, describe, expect, it, vi } from "vitest";
import { parseNominatim, rankResults, searchPlaces, shortAddress, type GeoResult } from "@/lib/geocode";

const VIJAYAWADA = { lat: 16.5062, lng: 80.648 };
const mk = (name: string, lat: number, lng: number, confidence: number): GeoResult => ({ name, address: "", displayName: name, lat, lng, confidence });

describe("shortAddress / parseNominatim", () => {
  it("drops the name, country and postcode so the region is readable", () => {
    expect(shortAddress("Kondapalli Fort, Kondapalli, NTR District, Andhra Pradesh, 521228, India")).toBe("Kondapalli, NTR District, Andhra Pradesh");
  });
  it("reads name, address and coordinates; skips broken rows", () => {
    const rows = parseNominatim([
      { lat: "16.6193", lon: "80.5321", name: "Kondapalli Fort", display_name: "Kondapalli Fort, Kondapalli, Andhra Pradesh, India", importance: 0.3 },
      { lat: "nope", lon: "x" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Kondapalli Fort", address: "Kondapalli, Andhra Pradesh", lat: 16.6193, lng: 80.5321 });
  });
  it("falls back to the first part of display_name when there's no name", () => {
    expect(parseNominatim([{ lat: "1", lon: "2", display_name: "Somewhere, India" }])[0].name).toBe("Somewhere");
  });
});

describe("rankResults — the 'Vijayawada shows up in Maharashtra' problem", () => {
  const maharashtraFamous = mk("Fort (Maharashtra)", 18.76, 73.41, 0.9); // ~800 km from Vijayawada
  const localDecent = mk("Fort (Andhra)", 16.62, 80.53, 0.6); // ~15 km from Vijayawada

  it("a famous match 800 km away loses to a decent local match", () => {
    expect(rankResults([maharashtraFamous, localDecent], VIJAYAWADA)[0].name).toBe("Fort (Andhra)");
  });
  it("without a bias the provider's own order of importance wins (no hidden behaviour)", () => {
    expect(rankResults([maharashtraFamous, localDecent])[0].name).toBe("Fort (Maharashtra)");
    expect(rankResults([maharashtraFamous, localDecent], null)[0].name).toBe("Fort (Maharashtra)");
  });
  it("proximity can't rescue a hopeless match: the penalty is capped", () => {
    const junk = mk("Junk nearby", 16.51, 80.65, 0.1);
    const real = mk("Real far", 28.6, 77.2, 0.95);
    expect(rankResults([junk, real], VIJAYAWADA)[0].name).toBe("Real far");
  });
  it("does not mutate its input", () => {
    const input = [maharashtraFamous, localDecent];
    rankResults(input, VIJAYAWADA);
    expect(input[0].name).toBe("Fort (Maharashtra)");
  });
});

describe("searchPlaces", () => {
  afterEach(() => vi.unstubAllGlobals());

  const row = (lat: string, lon: string, state: string, importance: number) => ({ lat, lon, name: "Fort", display_name: `Fort, ${state}, India`, importance });

  it("searches INSIDE the region around the trip first (bounded), so the local match is returned", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return { ok: true, json: async () => [row("16.62", "80.53", "Andhra Pradesh", 0.3)] };
    });
    const out = await searchPlaces("Fort", VIJAYAWADA, 5);
    expect(calls).toHaveLength(1); // the local result was enough — no second request
    expect(calls[0]).toContain("bounded=1");
    expect(calls[0]).toContain("viewbox=");
    expect(calls[0]).toContain("countrycodes=in");
    expect(out[0].address).toContain("Andhra Pradesh");
  });

  it("falls back to ALL of India only when the region has no match", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return { ok: true, json: async () => (String(url).includes("bounded=1") ? [] : [row("15.5", "73.8", "Goa", 0.5)]) };
    });
    const out = await searchPlaces("Goa Beach", VIJAYAWADA, 5);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("bounded=1");
    expect(calls[1]).not.toContain("bounded=1");
    expect(out[0].address).toContain("Goa");
  }, 10_000);

  it("without a trip location it just searches India (no box)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return { ok: true, json: async () => [row("17.38", "78.48", "Telangana", 0.6)] };
    });
    await searchPlaces("Hyderabad");
    expect(calls[0]).not.toContain("viewbox");
    expect(calls[0]).not.toContain("bounded");
  });

  it("returns [] (never throws) when the provider fails", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("network"); });
    expect(await searchPlaces("Fort")).toEqual([]);
  });
});
