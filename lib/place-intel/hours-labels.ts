// Words for an hours answer, the same on every screen (and testable without a browser). Confirmed and unconfirmed hours are never
// worded alike: "unconfirmed (map data)" is always said where it applies.
import type { HoursAnswer } from "./hours-answer";

export type HoursTone = "good" | "warn" | "bad" | "plain";

/** A short label and its tone. */
export function hoursBadge(a: Pick<HoursAnswer, "status" | "source">): { label: string; tone: HoursTone } {
  switch (a.status) {
    case "known":
      if (a.source?.kind === "member") return { label: "Confirmed on your trip", tone: "good" };
      if (a.source?.kind === "curated") return { label: `Checked by ${a.source.name}`, tone: "good" };
      return { label: `Map data, checked ${a.source?.date ?? "recently"}`, tone: "good" };
    case "unverified": return { label: "Unconfirmed (map data)", tone: "warn" };
    case "partial": return { label: "Partly known", tone: "warn" };
    case "conflicting": return { label: "Sources disagree", tone: "bad" };
    case "open_access": return { label: "Usually open ground", tone: "plain" };
    case "not_applicable": return { label: "No opening time of its own", tone: "plain" };
    default: return { label: "No hours recorded", tone: "plain" };
  }
}

/** "Source: map data (OpenStreetMap), data of 2026-10-28, not confirmed." */
export function sourceLine(a: Pick<HoursAnswer, "source" | "status">): string | null {
  const s = a.source;
  if (!s) return null;
  if (s.kind === "member") return s.checked ? `Source: confirmed by a member of this trip${s.date ? ` on ${s.date}` : ""}.` : "Source: map data saved on this trip, not confirmed by anyone.";
  if (s.kind === "curated") return `Source: ${s.name}, read on ${s.date}, checked by a person.`;
  return s.checked ? `Source: OpenStreetMap, a mapper last checked these hours on ${s.date}.` : `Source: OpenStreetMap${s.date ? ` (data of ${s.date})` : ""}. Not confirmed.`;
}

/** What to do next when the hours aren't simply known. */
export function nextStep(a: Pick<HoursAnswer, "status" | "officialLink">, canAddHours: boolean): string | null {
  if (a.status === "known" || a.status === "not_applicable" || a.status === "open_access") return null;
  const parts: string[] = [];
  if (a.officialLink) parts.push("check the place's own page");
  if (canAddHours) parts.push("add the hours you know");
  return parts.length ? `You can ${parts.join(", or ")}.` : null;
}
