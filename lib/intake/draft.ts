// The guided flow's state, as plain data and pure functions (the screens only render it). Priority for every answer:
//   the traveller's own tap ("you")  >  what they wrote ("said" by our reader, or "ai" backed by their words)  >  a visible default.
// Questions: only what is still missing, in a fixed order, at most 3 at a time; anything can be skipped (the default then stays).
import type { PlaceCategory } from "@/lib/categories";
import type { Suggestion } from "./defaults";
import { categoryFor } from "./fit-meter";
import type { AiReading } from "./ai-read";
import { mergeReadings } from "./merge";
import type { Option, PlaceMatch } from "./places";
import type { InstantReading } from "./read";
import { GROUP_LABEL, INTEREST_LABEL, MODE_LABEL, PACE_LABEL, STAY_LABEL, type AnswerKey, type Source, type TripAnswers, type Understanding } from "./types";

export type AiState = "idle" | "reading" | "ok" | "slow" | "busy" | "limit" | "off" | "failed" | "offline";
/** `category`: set when the kind of place is already known (a ready-made example), so the saved plan matches the one that was shown. */
export type DraftPlace = PlaceMatch & { key: string; category?: PlaceCategory };
export type Draft = {
  text: string;
  start: { place: Option | null; from: "you" | "text" | null };
  understanding: Understanding | null;
  /** The traveller's own choices. */
  chosen: Partial<TripAnswers>;
  skipped: AnswerKey[];
  places: DraftPlace[];
  ai: AiState;
};

export const emptyDraft = (): Draft => ({ text: "", start: { place: null, from: null }, understanding: null, chosen: {}, skipped: [], places: [], ai: "idle" });

/** The order questions are asked in (the approved order: when, how long, who, how, pace & driving, interests, stay, avoid). */
export const QUESTION_ORDER: AnswerKey[] = ["month", "days", "group", "mode", "pace", "nightDriving", "interests", "stay", "avoid"];
export const MAX_QUESTIONS = 3;

const placeKey = (p: PlaceMatch) => (p.place ? `${p.place.lat.toFixed(3)},${p.place.lng.toFixed(3)}` : `said:${p.said.toLowerCase()}`);

/** Apply the instant reading (replaces any earlier reading of a previous text; keeps the traveller's taps). */
export function withInstant(d: Draft, text: string, reading: { understanding: Understanding; start: { place: Option | null; from: "you" | "text" | null }; places: PlaceMatch[] }): Draft {
  const keepStart = d.start.from === "you" ? d.start : reading.start;
  const kept = d.places.filter((p) => p.key.startsWith("you:")); // places added by hand (search, "Add" on a suggestion) stay
  return { ...d, text, understanding: reading.understanding, start: keepStart, places: mergePlaceLists(kept, reading.places), ai: "reading" };
}

/** Apply the AI's checked reading when (if) it arrives. */
export function withAi(d: Draft, instant: InstantReading | null, ai: { status: AiState; reading: AiReading | null; start: { place: Option | null; from: "you" | "text" | null } | null; places: PlaceMatch[] }): Draft {
  if (ai.status !== "ok" || !ai.reading) return { ...d, ai: ai.status };
  const understanding = instant ? mergeReadings(instant, ai.reading) : mergeIntoUnderstanding(d.understanding, ai.reading);
  const start = d.start.place || !ai.start?.place ? d.start : ai.start;
  return { ...d, understanding, start, places: mergePlaceLists(d.places, ai.places), ai: "ok" };
}

function mergeIntoUnderstanding(u: Understanding | null, ai: AiReading): Understanding {
  const base: Understanding = u ?? { answers: {}, places: [], conflicts: [], unbacked: [], scripts: [] };
  const answers = { ...base.answers } as Record<string, { value: unknown; source: Source; evidence: string }>;
  const conflicts = [...base.conflicts];
  for (const [k, v] of Object.entries(ai.answers)) {
    const mine = answers[k];
    if (!mine) answers[k] = v as never;
    else if (k === "interests") answers[k] = { ...mine, value: [...new Set([...(mine.value as string[]), ...((v as { value: string[] }).value)])] };
    else if (JSON.stringify(mine.value) !== JSON.stringify((v as { value: unknown }).value) && k !== "startSaid" && k !== "endSaid") conflicts.push({ key: k as AnswerKey, said: mine.value, ai: (v as { value: unknown }).value });
  }
  return { ...base, answers: answers as Understanding["answers"], conflicts, unbacked: [...base.unbacked, ...ai.unbacked] };
}

/** One list: the same real place once (by position), the AI's cleaner name kept when both readers found it. */
export function mergePlaceLists(a: DraftPlace[] | PlaceMatch[], b: PlaceMatch[]): DraftPlace[] {
  const out: DraftPlace[] = a.map((p) => ({ ...p, key: (p as DraftPlace).key ?? placeKey(p) }));
  for (const p of b) {
    const k = placeKey(p);
    const i = out.findIndex((o) => o.key === k || (o.status === "missing" && p.place && o.said.toLowerCase() === p.said.toLowerCase()));
    if (i === -1) out.push({ ...p, key: k });
    else if (out[i].status === "missing" && p.place) out[i] = { ...p, key: k, must: out[i].must || p.must };
    else out[i] = { ...out[i], must: out[i].must || p.must };
  }
  return out;
}

export type Effective = { answers: TripAnswers; source: Partial<Record<AnswerKey, Source>> };

export function effectiveAnswers(d: Draft, defaults: Suggestion[]): Effective {
  const answers: Record<string, unknown> = {};
  const source: Partial<Record<AnswerKey, Source>> = {};
  for (const s of defaults) { answers[s.key] = s.value; source[s.key] = "default"; }
  for (const [k, v] of Object.entries(d.understanding?.answers ?? {})) { answers[k] = v!.value; source[k as AnswerKey] = v!.source; }
  for (const [k, v] of Object.entries(d.chosen)) if (v !== undefined) { answers[k] = v; source[k as AnswerKey] = "you"; }
  return { answers: answers as TripAnswers, source };
}

/** What to ask next: conflicts first, then missing answers in order (defaults count as missing until confirmed or skipped). At most 3. */
export function questionsToAsk(d: Draft, eff: Effective): AnswerKey[] {
  const conflicted = (d.understanding?.conflicts ?? []).map((c) => c.key).filter((k) => d.chosen[k] === undefined);
  const missing = QUESTION_ORDER.filter((k) => (eff.source[k] === undefined || eff.source[k] === "default") && !d.skipped.includes(k) && !conflicted.includes(k));
  return [...new Set([...conflicted, ...missing])].slice(0, MAX_QUESTIONS);
}

export type Chip = { key: AnswerKey | "start"; text: string; source: Source | "start" };

/** "4 days · from Hyderabad · Friends · Relaxed · Own car" — each chip opens its question to change it. */
export function summaryChips(d: Draft, eff: Effective): Chip[] {
  const a = eff.answers, s = eff.source;
  const chips: Chip[] = [];
  if (a.days) chips.push({ key: "days", text: `${a.days} ${a.days === 1 ? "day" : "days"}`, source: s.days! });
  if (d.start.place) chips.push({ key: "start", text: `from ${d.start.place.name}`, source: "start" });
  if (a.month) chips.push({ key: "month", text: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][a.month - 1], source: s.month! });
  if (a.group) chips.push({ key: "group", text: GROUP_LABEL[a.group] + (a.groupSize ? ` (${a.groupSize})` : ""), source: s.group! });
  if (a.mode) chips.push({ key: "mode", text: MODE_LABEL[a.mode], source: s.mode! });
  if (a.pace) chips.push({ key: "pace", text: PACE_LABEL[a.pace], source: s.pace! });
  if (a.maxDriveHours) chips.push({ key: "maxDriveHours", text: `≤ ${a.maxDriveHours} h driving a day`, source: s.maxDriveHours! });
  if (a.nightDriving === false) chips.push({ key: "nightDriving", text: "No night driving", source: s.nightDriving! });
  if (a.interests?.length) chips.push({ key: "interests", text: a.interests.map((i) => INTEREST_LABEL[i]).join(" · "), source: s.interests! });
  if (a.stay) chips.push({ key: "stay", text: STAY_LABEL[a.stay], source: s.stay! });
  if (a.endMode) chips.push({ key: "endMode", text: a.endMode === "start" ? "Return to start" : a.endMode === "place" ? "One way" : "Open-ended", source: s.endMode! });
  return chips;
}

/** The places the planner may use: found ones only (a "missing" place has no position). States are kept but not planned as stops. */
export const usablePlaces = (d: Draft) => d.places.filter((p) => p.place && p.status !== "missing");

/** The two requests that create the trip and add its places (the existing endpoints). Pure, so it is tested. */
/** `startDate`: the first day the traveller confirmed in the save step ("YYYY-MM-DD"), or null for "no dates yet". */
export function tripRequests(d: Draft, eff: Effective, name?: string, startDate: string | null = null) {
  const a = eff.answers;
  const start = d.start.place;
  const places = usablePlaces(d).filter((p) => p.place!.kind !== "state");
  const end = a.endMode === "place" ? places[places.length - 1]?.place ?? null : null;
  const autoName = `${start ? `${start.name} · ` : ""}${places.slice(0, 2).map((p) => p.place!.name).join(", ")}${places.length > 2 ? ` +${places.length - 2}` : ""} · ${a.days ?? 3} days`.slice(0, 80);
  const intake = Object.fromEntries(Object.entries({
    group: a.group, group_size: a.groupSize, mode: a.mode, pace: a.pace, max_drive_hours: a.maxDriveHours, night_driving: a.nightDriving,
    interests: a.interests?.length ? a.interests : undefined, stay: a.stay, avoid: a.avoid?.length ? a.avoid.slice(0, 8) : undefined, month: a.month,
  }).filter(([, v]) => v !== undefined));
  return {
    trip: {
      name: (name?.trim() || autoName).slice(0, 80),
      start_city: start?.name ?? null, start_lat: start?.lat ?? null, start_lng: start?.lng ?? null,
      end_mode: a.endMode === "place" && !end ? "open" : a.endMode ?? "start",
      dest_name: end?.name ?? null, dest_lat: end?.lat ?? null, dest_lng: end?.lng ?? null,
      start_date: startDate, num_days: a.days ?? 3, intake,
    },
    places: places.slice(0, 20).map((p) => ({
      name: p.place!.name, lat: p.place!.lat, lng: p.place!.lng,
      // The same kind the fit meter used, so the planner's visit times match what the traveller saw.
      category: p.category ?? (categoryFor(p.place!) === "other" ? null : categoryFor(p.place!)),
      source_type: p.source === "ai" ? "ai_text" : "search", address: p.place!.area || null,
      ...(p.must ? { priority: "must" as const } : {}),
    })),
    mustNames: places.filter((p) => p.must).map((p) => p.place!.name),
  };
}
