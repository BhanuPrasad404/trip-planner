// SERVER ONLY (it uses the LGPL opening_hours parser through lib/server/opening-hours.ts). One answer to "what are this place's hours on
// that day?", the same for every screen (lib/place-intel/hours-answer.ts).
//
// Rules:
//   • A city, a town, a district or a valley has no opening time of its own: "not applicable", never "missing".
//   • Sources, strongest first: a trip member's confirmed hours → a curated source a person checked → map data a mapper re-checked in the
//     last 2 years (check_date) → other map data. The strongest readable one answers; a weaker one NEVER replaces it. Any source that
//     says something different is listed with where it comes from. Two sources of the same standing that disagree: "conflicting", and
//     neither is picked.
//   • The visit date, in India time (IST, +05:30), not "today". Hours that cross midnight are kept whole ("until 2:00 AM").
//   • Holiday rules (PH/SH): we have no Indian holiday calendar, so "unable to verify", never a guess. Comments and open-ended times are
//     "partial". Nothing is ever invented: no schedule from AI, from memory, or from the kind of place.
import type { RoleAnswer } from "@/lib/place-intel/role";
import type { CuratedHours } from "@/lib/place-intel/hours-adapters";
import type { DayInterval, HoursAnswer, HoursSource } from "@/lib/place-intel/hours-answer";
import type { OsmHoursRow } from "@/lib/place-intel/hours-sources";
import { INDIA_UTC_OFFSET_MIN, time12 } from "@/lib/travel/clock";
import { HOLIDAY_REASON, openIntervals, validateHours } from "./opening-hours";

/** One matched map object: ref "osm/way/123", the data's own date, and the hours facts as mapped (lib/place-intel/hours-sources.ts). */
export type OsmHoursFacts = OsmHoursRow;
export type HoursFacts = {
  /** Hours on the trip stop: typed or confirmed by a member (confirmed), or map data nobody confirmed. confirmedAt: when, if recorded. */
  member?: { text: string; confirmed: boolean; confirmedAt: string | null } | null;
  curated?: CuratedHours[];
  /** One per map object matched to the place (exact id first). */
  osm?: OsmHoursFacts[];
};
export type HoursPlace = { name: string; lat: number; lng: number; role: RoleAnswer };

/** A mapper's check this recent (before the visit) counts as a person having checked the hours. */
export const CHECK_DATE_FRESH_DAYS = 730;
const DAY_MS = 86_400_000;
const OFF = INDIA_UTC_OFFSET_MIN;
export const ACCESS_NOTE = "Opening hours are a schedule, not a promise of entry: queues, tickets, special darshan and festival days can change it on the day.";
const OPEN_GROUND_NOTE = "Usually open ground. Access can still be limited at night, in bad weather or by local rules.";
const WEEKDAY = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

const dayStartUtc = (date: string) => Date.parse(`${date}T00:00:00Z`) - OFF * 60_000;
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

type Candidate = { source: HoursSource; schedule: string; strength: number };

/** The visit date's intervals (kept whole across midnight), or why they can't be worked out. */
function dayOf(schedule: string, date: string, where: { lat: number; lng: number }): { ok: true; intervals: DayInterval[] } | { ok: false; holiday: boolean; reason: string } {
  const start = dayStartUtc(date), end = start + DAY_MS;
  // A wider window so an evening that runs past midnight (or a night that began the day before) is not cut at 00:00.
  const w = openIntervals(schedule, start - DAY_MS / 2, end + DAY_MS / 2, OFF, where);
  if (w.status !== "ok") return { ok: false, holiday: w.reason === HOLIDAY_REASON, reason: w.reason };
  const merged: DayInterval[] = [];
  for (const iv of [...w.intervals].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1] && iv[2] === last[2]) last[1] = Math.max(last[1], iv[1]); else merged.push([iv[0], iv[1], iv[2]]);
  }
  // Only what is open during the visit date (an opening that started the evening before still counts until it closes).
  return { ok: true, intervals: merged.filter(([a, b]) => b > start && a < end) };
}

function dayText(intervals: DayInterval[], date: string): string {
  if (!intervals.length) return `Closed on ${dateLabel(date)}`;
  const start = dayStartUtc(date), end = start + DAY_MS;
  return intervals.map(([a, b, unknown]) => {
    if (b - a >= DAY_MS && a <= start && b >= end) return unknown ? "all day (not certain)" : "open all day";
    const from = a < start ? "from the night before" : time12(a, OFF);
    const to = b > end ? `${time12(b, OFF)} (next day)` : time12(b, OFF);
    return `${from} – ${to}${unknown ? " (not certain)" : ""}`;
  }).join(", ");
}

/** Same opening times on the visit date (and the week after it), whatever the wording. */
function sameDays(a: string, b: string, date: string, where: { lat: number; lng: number }): boolean {
  if (a.trim() === b.trim()) return true;
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.parse(`${date}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10);
    const x = dayOf(a, d, where), y = dayOf(b, d, where);
    if (!x.ok || !y.ok) return false;
    if (JSON.stringify(x.intervals) !== JSON.stringify(y.intervals)) return false;
  }
  return true;
}

/** Weekdays the schedule is closed all day (the week from the visit date). */
function closedDays(schedule: string, date: string, where: { lat: number; lng: number }): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.parse(`${date}T00:00:00Z`) + i * DAY_MS);
    const r = dayOf(schedule, d.toISOString().slice(0, 10), where);
    if (r.ok && r.intervals.length === 0) out.push(WEEKDAY[d.getUTCDay()]);
  }
  return out.length === 7 ? [] : out;
}

function candidates(facts: HoursFacts, date: string): Candidate[] {
  const out: Candidate[] = [];
  if (facts.member?.text) {
    const confirmed = facts.member.confirmed;
    out.push({ schedule: facts.member.text, strength: confirmed ? 4 : 1, source: { kind: "member", name: confirmed ? "A trip member" : "Map data saved on this trip", ref: null, date: facts.member.confirmedAt?.slice(0, 10) ?? null, checked: confirmed } });
  }
  for (const c of facts.curated ?? []) out.push({ schedule: c.schedule, strength: 3, source: { kind: "curated", name: c.name, ref: c.sourceUrl, date: c.readOn, checked: true } });
  for (const o of facts.osm ?? []) {
    if (!o.openingHours) continue;
    const fresh = !!o.checkDate && daysBetween(o.checkDate, date) <= CHECK_DATE_FRESH_DAYS && daysBetween(o.checkDate, date) >= -1;
    out.push({ schedule: o.openingHours, strength: fresh ? 2 : 1, source: { kind: "osm", name: "OpenStreetMap", ref: o.ref, date: o.checkDate ?? o.dataDate, checked: fresh } });
  }
  return out.sort((a, b) => b.strength - a.strength);
}

/** "a city", "a district", "a valley": from the role's own evidence ("It is a city (about …)", "Wikidata lists it as a valley"). */
export function whatItIs(role: RoleAnswer): string {
  for (const r of role.reasons) {
    const m = /^It is (an? [^(]+?)\s*(?:\(|$)/.exec(r) ?? /lists it as (an? [a-z ]+)$/i.exec(r);
    if (m) return m[1].trim();
  }
  return role.role === "settlement" ? "a town" : "an area";
}

const srcWords = (s: HoursSource) => `${s.kind === "osm" ? (s.checked ? "map data, last checked by a mapper" : "map data") : s.name}${s.date ? ` ${s.kind === "osm" && s.checked ? "on" : "as of"} ${s.date}` : ""}`;

export function resolveHours(place: HoursPlace, facts: HoursFacts, date: string): HoursAnswer {
  const name = place.name;
  const where = { lat: place.lat, lng: place.lng };
  const osm = facts.osm ?? [];
  const checked = [
    ...(facts.member ? [{ name: "This trip's saved hours", date: facts.member.confirmedAt?.slice(0, 10) ?? null }] : []),
    ...(facts.curated ?? []).map((c) => ({ name: c.name, date: c.readOn })),
    ...osm.map((o) => ({ name: `OpenStreetMap (${o.ref})`, date: o.dataDate })),
  ];
  const link = (facts.curated ?? [])[0]
    ? { url: facts.curated![0].sourceUrl, label: `${facts.curated![0].name} page` }
    : osm.find((o) => o.hoursUrl) ? { url: osm.find((o) => o.hoursUrl)!.hoursUrl!, label: "Page with the hours" }
      : osm.find((o) => o.website) ? { url: osm.find((o) => o.website)!.website!, label: "Official website" } : null;
  const service = osm.find((o) => o.serviceTimes)?.serviceTimes ?? null;
  const base = { place: name, date, schedule: null, serviceTimes: service, day: null, source: null, checked, exceptions: [] as string[], officialLink: link, conflicts: [] as HoursAnswer["conflicts"] };

  // A settlement or an area: no opening time of its own, whatever a map object near its middle says.
  if (place.role.hours === "not_applicable") {
    return { ...base, status: "not_applicable", why: "no_own_hours", access: "", officialLink: null, serviceTimes: null, checked: [],
      message: `${name} is ${whatItIs(place.role)}, so it has no single opening time. The places to visit in it have their own hours.` };
  }

  // Only readable schedules can answer; an unreadable one is kept to say why.
  const all = candidates(facts, date);
  const readable = all.filter((c) => validateHours(c.schedule, where).ok);
  const unreadable = all.filter((c) => !readable.includes(c));
  if (!readable.length) {
    if (unreadable.length) {
      const u = unreadable[0];
      return { ...base, status: "unverified", why: "unreadable", schedule: u.schedule, source: u.source, access: ACCESS_NOTE,
        message: `${name} has hours written in a way we can't read (${srcWords(u.source)}). They are shown as written; check them before you go.` };
    }
    if (service) {
      return { ...base, status: "partial", why: "service_times_only", access: ACCESS_NOTE,
        message: `${name}: the map lists service (darshan / prayer) times, not general opening hours. They are shown as written.` };
    }
    if (place.role.hours === "open_access_likely") {
      return { ...base, status: "open_access", why: null, access: OPEN_GROUND_NOTE,
        message: `${name} is usually open ground, and no opening hours are recorded for it.` };
    }
    return { ...base, status: "none", why: "missing", access: ACCESS_NOTE,
      message: `No opening hours are recorded for ${name}${osm.length ? " on the map" : ""}.${link ? " Its own page may have them." : ""} If you know them, you can add them.` };
  }

  // Strongest first; two of the same standing that disagree are a conflict, not a choice.
  const top = readable[0];
  const rivals = readable.filter((c) => c !== top && c.strength === top.strength && !sameDays(c.schedule, top.schedule, date, where));
  const differ = readable.filter((c) => c !== top && !rivals.includes(c) && !sameDays(c.schedule, top.schedule, date, where));
  const conflicts = [...rivals, ...differ, ...unreadable].map((c) => ({ source: c.source, schedule: c.schedule }));
  if (rivals.length) {
    return { ...base, status: "conflicting", why: "conflicting", conflicts: [{ source: top.source, schedule: top.schedule }, ...conflicts], access: ACCESS_NOTE,
      message: `Sources disagree about ${name}'s hours: ${[top, ...rivals].map((c) => `“${c.schedule}” (${srcWords(c.source)})`).join(" vs ")}. Check before you go.` };
  }

  const exceptions: string[] = [];
  const notes = [...top.schedule.matchAll(/"([^"]{1,80})"/g)].map((m) => m[1]);
  for (const n of notes) exceptions.push(`Note from the source: “${n}”`);
  if (service) exceptions.push(`Service (darshan / prayer) times as mapped: ${service}`);
  const result = { ...base, schedule: top.schedule, source: top.source, conflicts, access: ACCESS_NOTE };
  const day = dayOf(top.schedule, date, where);
  if (!day.ok) {
    if (day.holiday) exceptions.push("The hours change on public or school holidays.");
    return { ...result, exceptions, status: "unverified", why: day.holiday ? "holiday_rule" : "unreadable",
      message: day.holiday
        ? `${name}'s hours change on public holidays, and we have no Indian holiday calendar, so we are unable to verify them for ${dateLabel(date)}. They are shown as written.`
        : `${name} has hours we can't work out for ${dateLabel(date)}. They are shown as written.` };
  }
  const closed = closedDays(top.schedule, date, where);
  if (closed.length) exceptions.unshift(`Closed on ${closed.join(", ")} (by this schedule)`);
  const text = dayText(day.intervals, date);
  const partUnknown = day.intervals.some((iv) => iv[2]);
  const checkedWords = `${srcWords(top.source)}`;
  const conflictWords = conflicts.length ? ` ${conflicts.length === 1 ? "Another source says" : "Other sources say"} something different (shown below).` : "";
  if (partUnknown) {
    return { ...result, exceptions, day: { intervals: day.intervals, text }, status: "partial", why: "part_unknown",
      message: `${name} on ${dateLabel(date)}: ${text}. Part of the schedule can't be read for certain (${checkedWords}).${conflictWords}` };
  }
  if (!top.source.checked) {
    return { ...result, exceptions, day: { intervals: day.intervals, text }, status: "unverified", why: "not_verified",
      message: `${name} on ${dateLabel(date)}: ${text}, according to ${checkedWords}. Nobody has confirmed these hours recently.${conflictWords}` };
  }
  return { ...result, exceptions, day: { intervals: day.intervals, text }, status: "known", why: null,
    message: `${name} on ${dateLabel(date)}: ${text} (${checkedWords}).${conflictWords}` };
}
