// The two halves of "read what the traveller wrote", as plain functions with their outside services injected (the routes pass the real
// ones, tests pass fakes). Both resolve names to real places with lib/intake/places.ts.
import type { ToolCaller } from "@/lib/ai/types";
import { AiNotConfiguredError, AiRequestError } from "@/lib/ai/types";
import { INDIA_UTC_OFFSET_MIN, dateOf } from "@/lib/travel/clock";
import { AiSlowError, aiReadTrip, type AiReading } from "./ai-read";
import { mergeReadings } from "./merge";
import { resolvePlaces, resolveStart, type Option, type PlaceMatch, type ResolveDeps } from "./places";
import { readTrip } from "./read";
import type { Understanding } from "./types";

type Start = { lat: number; lng: number; name: string } | null;
export type StartAnswer = { place: Option | null; alternatives: Option[]; /** "you" = chosen with the picker; "text" = read from the words. */ from: "you" | "text" | null };

/** Today's month in India (1–12), whatever the server's clock zone. */
export const indiaMonth = (now = Date.now()) => Number(dateOf(now, INDIA_UTC_OFFSET_MIN).slice(5, 7));

export type InstantAnswer = { understanding: Understanding; start: StartAnswer; places: PlaceMatch[] };

export async function readInstant(text: string, chosenStart: Start, deps: ResolveDeps, now = Date.now()): Promise<InstantAnswer> {
  const instant = readTrip(text, { todayMonth: indiaMonth(now) });
  const start = await startFor(chosenStart, instant.startCandidates, deps);
  const anchor = start.place ? { lat: start.place.lat, lng: start.place.lng, name: start.place.name } : null;
  const places = await resolvePlaces(instant.places, { start: anchor }, deps);
  return { understanding: mergeReadings(instant, null), start, places };
}

/** ok · slow (gave up waiting) · busy (rate-limited by the AI service) · limit (our daily limit) · off (no AI key) · failed (anything else). */
export type AiStatus = "ok" | "slow" | "busy" | "limit" | "off" | "failed";
export type AiAnswer = { status: AiStatus; reading: AiReading | null; start: StartAnswer | null; places: PlaceMatch[] };

export async function readWithAi(text: string, chosenStart: Start, deps: ResolveDeps & { llm: ToolCaller; allowAi: () => Promise<boolean>; timeoutMs?: number }, now = Date.now()): Promise<AiAnswer> {
  const none = (status: AiStatus): AiAnswer => ({ status, reading: null, start: null, places: [] });
  if (!(await deps.allowAi())) return none("limit");
  let reading: AiReading;
  try {
    reading = await aiReadTrip(text, deps.llm, { todayMonth: indiaMonth(now), timeoutMs: deps.timeoutMs ?? 12_000 });
  } catch (e) {
    if (e instanceof AiSlowError) return none("slow");
    if (e instanceof AiNotConfiguredError) return none("off");
    if (e instanceof AiRequestError && (e.status === 429 || e.status === 503)) return none("busy");
    return none("failed");
  }
  const said = reading.answers.startSaid?.value;
  const start = await startFor(chosenStart, said ? [said] : [], deps);
  const anchor = start.place ? { lat: start.place.lat, lng: start.place.lng, name: start.place.name } : null;
  return { status: "ok", reading, start, places: await resolvePlaces(reading.places, { start: anchor }, deps) };
}

async function startFor(chosen: Start, candidates: string[], deps: ResolveDeps): Promise<StartAnswer> {
  if (chosen) return { place: { id: "chosen", name: chosen.name, lat: chosen.lat, lng: chosen.lng, kind: "place", area: "", state: null, source: "trailmate", km: 0, calledAs: null }, alternatives: [], from: "you" };
  const r = await resolveStart(candidates, deps);
  return { ...r, from: r.place ? "text" : null };
}
