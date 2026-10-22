import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, parseBody } from "@/lib/api";
import { areaOf, forecastHorizonMs, kmFromArea } from "@/lib/forecast/areas";
import { encodeArea, type WeatherResponse } from "@/lib/forecast/wire";
import { getOpenMeteoConfig } from "@/lib/env";
import { weatherProvider } from "@/lib/providers/registry";
import type { AreaForecast } from "@/lib/providers/types";
import { consumeQuota } from "@/lib/quota";
import { weatherSchema } from "@/lib/validation/schemas";

export const maxDuration = 20;

/** Requests per person per day. The app asks about every 30 minutes per open trip, plus on coming back to it. */
const DAILY_LIMIT = 1_500;
/** How far back a window may start (the current hour's values need the hour before). */
const PAST_MS = 6 * 3_600_000;

// The weather for many places over a time window, in one request. Places are grouped into forecast areas (~10 km) on the server, so
// the answer and the outside calls stay small however many stops a trip has. Every area says when its forecast was fetched; an area
// that is unavailable is null, never filled in. The app decides what to show from these (lib/forecast, lib/weather-rules.ts).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const { data: input, error } = await parseBody(req, weatherSchema);
  if (error) return error;
  if (!(await consumeQuota(supabase, "weather", DAILY_LIMIT))) return jsonError("Weather has been checked very often today. It will be available again within 24 hours.", 429);

  const now = Date.now();
  const horizonEnd = forecastHorizonMs(now);

  // Each area's window covers every place in it (its own window, else the request's), clipped to "recent past" … horizon.
  const places: WeatherResponse["places"] = {};
  const byArea = new Map<string, { area: ReturnType<typeof areaOf>; from: number; to: number }>();
  for (const p of input.places) {
    const a = areaOf(p);
    places[p.id] = { area: a.key, km: kmFromArea(p, a) };
    const from = Math.max(p.from ?? input.from, now - PAST_MS), to = Math.min(p.to ?? input.to, horizonEnd);
    const cur = byArea.get(a.key);
    byArea.set(a.key, cur ? { area: a, from: Math.min(cur.from, from), to: Math.max(cur.to, to) } : { area: a, from, to });
  }
  // Areas with the same window are asked for together (the provider batches them into as few outside requests as it can).
  const groups = new Map<string, { areas: ReturnType<typeof areaOf>[]; from: number; to: number }>();
  for (const w of byArea.values()) {
    if (w.to < w.from) continue; // nothing forecast for that window
    const k = `${w.from}|${w.to}`;
    const g = groups.get(k) ?? { areas: [], from: w.from, to: w.to };
    g.areas.push(w.area); groups.set(k, g);
  }
  const got: Record<string, AreaForecast | null> = {};
  await Promise.all([...groups.values()].map(async (g) => Object.assign(got, await weatherProvider().areaForecasts(g.areas, g.from, g.to).catch(() => ({})))));
  const body: WeatherResponse = {
    source: weatherProvider().id,
    commercial: getOpenMeteoConfig().commercial,
    generatedAt: now,
    horizonEnd,
    places,
    areas: Object.fromEntries([...byArea.keys()].map((k) => [k, got[k] ? encodeArea(got[k]!) : null])),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
