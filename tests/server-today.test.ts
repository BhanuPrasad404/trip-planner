// The server's "today" for the trip pages is India's date, whatever the phone (or the old tm_tz cookie it used to send) says.
import { afterEach, describe, expect, it, vi } from "vitest";
const jar = vi.hoisted(() => ({ tz: "540" as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (k === "tm_tz" && jar.tz ? { value: jar.tz } : undefined) }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
import { todayISO } from "@/lib/server/trip-data";

const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h, m) - 330 * 60_000;
const TZ = process.env.TZ;
afterEach(() => { vi.restoreAllMocks(); process.env.TZ = TZ; });

describe("server 'today' is India's date", () => {
  it.each([
    ["Asia/Tokyo", "540", ist(22, 23, 45), "2026-10-22"], // Tokyo is already on the 23rd
    ["America/New_York", "-240", ist(23, 0, 30), "2026-10-23"], // New York is still on the 22nd
    ["UTC", undefined, ist(23, 3, 0), "2026-10-23"], // the server's own UTC is still the 22nd until 5:30 AM IST
  ])("phone on %s, old cookie %s: India date", async (tz, cookie, at, expected) => {
    process.env.TZ = tz; jar.tz = cookie;
    vi.spyOn(Date, "now").mockReturnValue(at);
    expect(await todayISO()).toBe(expected);
  });
});
