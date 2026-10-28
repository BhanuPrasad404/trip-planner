import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { OVERPASS_MIRRORS } from "@/lib/nearby";
import { classifyMapFailure } from "@/lib/explore/failure";

export const maxDuration = 60;

export type MapServerCheck = { host: string; ok: boolean; ms: number; detail: string };

// "Test my map servers": asks each map-data server one tiny question and says which answered, how fast, and why one didn't, so "the map
// servers are busy" is a fact you can see instead of a guess. One tiny question per server, a few times an hour.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`map-test:${user.id}`, 5, 10 * 60_000)) return jsonError("You've tested enough for now. Try again in a few minutes.", 429);

  const query = "data=" + encodeURIComponent('[out:json][timeout:10];nwr["tourism"="attraction"]["name"](around:3000,15.4909,73.8278);out center 1;');
  const headers = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (trip planner)" };
  const urls = [process.env.OVERPASS_URL, ...OVERPASS_MIRRORS].filter((u): u is string => !!u);
  const checks: MapServerCheck[] = [];
  for (const url of urls) {
    const host = new URL(url).host, started = Date.now();
    try {
      const res = await fetch(url, { method: "POST", headers, body: query, signal: AbortSignal.timeout(12_000) });
      const ms = Date.now() - started;
      if (!res.ok) { checks.push({ host, ok: false, ms, detail: `HTTP ${res.status}` }); continue; }
      const json = (await res.json().catch(() => null)) as { remark?: string } | null;
      if (json?.remark && /(timed out|out of memory|too many requests|rate_limited)/i.test(json.remark)) { checks.push({ host, ok: false, ms, detail: json.remark.slice(0, 80) }); continue; }
      checks.push({ host, ok: true, ms, detail: "answered" });
    } catch (e) {
      checks.push({ host, ok: false, ms: Date.now() - started, detail: e instanceof Error ? (e.name === "TimeoutError" ? "TimeoutError" : e.message.slice(0, 80)) : "error" });
    }
  }
  const ok = checks.filter((c) => c.ok);
  const failure = ok.length === 0 ? classifyMapFailure(`all map servers failed: ${checks.map((c) => `${c.host} -> ${c.detail}`).join("; ")}`) : null;
  const message = ok.length === 0 ? `No map server answered. ${failure!.hint}` : ok.length === checks.length ? `All ${checks.length} map servers answered (fastest ${Math.min(...ok.map((c) => c.ms))} ms).` : `${ok.length} of ${checks.length} map servers answered; lookups will use the ones that did.`;
  return NextResponse.json({ ok: ok.length > 0, message, checks }, { headers: { "Cache-Control": "private, no-store" } });
}
