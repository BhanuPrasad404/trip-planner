// The "ground report" of a post: what the traveler said about the place, turned into what the screen shows. Pure, so the card, the post
// page and the side panel all say the same thing, and so the honesty rules are tested in one place:
//   • a report is only "current" when the post is recent enough (freshness.usableAsCurrent);
//   • an old warning is shown calmly (grey), never as an alarm: conditions change;
//   • nothing is invented: no report means no chips, and the screen says there is none.
import { conditionLabel, CROWD_LABEL, vibeLabel, WARNING_CONDITIONS, type CrowdLevel } from "./experience";
import type { FeedItemDTO } from "./map";

export type Tone = "good" | "warn" | "neutral";
export type GroundChip = { id: string; label: string; tone: Tone; kind: "condition" | "vibe" };
export type GroundReport = {
  current: boolean;
  /** "Current · 2 hours ago" for a recent post; the plain age ("3 weeks ago", "Historical — posted July 2026") for an old one. */
  stamp: string;
  dot: "green" | "amber" | "grey";
  crowd: { level: CrowdLevel; label: string; /** 1 = quiet … 3 = crowded: the meter fills this many segments. */ filled: 1 | 2 | 3; tone: Tone } | null;
  /** Conditions first (warnings before the rest), then what it is good for. */
  chips: GroundChip[];
  warnings: number;
  fromArea: boolean;
  tip: string | null;
  /** The traveler told us nothing beyond the picture. */
  empty: boolean;
  /** True when the facts are about a past moment: the screen says "At the time". */
  atTheTime: boolean;
};

const CROWD_FILL: Record<CrowdLevel, 1 | 2 | 3> = { quiet: 1, moderate: 2, crowded: 3 };
const CROWD_TONE: Record<CrowdLevel, Tone> = { quiet: "good", moderate: "neutral", crowded: "warn" };

export function groundReport(item: Pick<FeedItemDTO, "experience" | "freshness">): GroundReport {
  const { experience: e, freshness: f } = item;
  const current = f.usableAsCurrent;
  const conditions: GroundChip[] = e.conditions.map((id) => {
    const warn = WARNING_CONDITIONS.has(id);
    return { id, label: conditionLabel(id), kind: "condition" as const, tone: (current ? (warn ? "warn" : "good") : "neutral") as Tone };
  });
  conditions.sort((a, b) => Number(b.tone === "warn") - Number(a.tone === "warn"));
  const vibes: GroundChip[] = e.vibes.map((id) => ({ id, label: vibeLabel(id), kind: "vibe" as const, tone: "neutral" as Tone }));
  const crowd = e.crowd ? { level: e.crowd, label: CROWD_LABEL[e.crowd], filled: CROWD_FILL[e.crowd], tone: (current ? CROWD_TONE[e.crowd] : "neutral") as Tone } : null;
  const hasDetail = !!(crowd || conditions.length || vibes.length || e.tip);
  return {
    current, stamp: current ? `Current · ${f.label}` : f.label, dot: f.dot, crowd,
    chips: [...conditions, ...vibes], warnings: current ? conditions.filter((c) => c.tone === "warn").length : 0,
    fromArea: e.fromArea, tip: e.tip, empty: !hasDetail && !e.fromArea,
    atTheTime: !current && !!(crowd || conditions.length),
  };
}
