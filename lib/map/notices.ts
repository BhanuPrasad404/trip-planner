// What the live map says to the traveller, in ONE place, so messages cannot pile up over the road.
//
// Rules (the product rule, kept here and tested):
//   • Every message has a severity. critical > important > info.
//   • At most `max` messages are on the map at once, EXCEPT critical ones: a safety message is never hidden to reduce clutter.
//   • What does not fit is counted ("2 more") and stays reachable in the route info sheet; nothing is lost, only moved off the map.
//   • Dismissing a message is acknowledging it. It stays away while the problem lasts, and comes back if the problem goes away and
//     later returns (so a flaky connection does not re-nag, but a NEW problem is not swallowed by an old dismissal).
//   • Only `info` messages may hide themselves after a while; critical and important ones stay until resolved or acknowledged.
export type NoticeSeverity = "critical" | "important" | "info";
export type HudNotice = {
  /** Same problem = same id (that is how it is de-duplicated and how a dismissal is remembered). */
  id: string;
  severity: NoticeSeverity;
  text: string;
  dismissible: boolean;
  /** Info only: hide by itself after this long. Ignored for critical and important messages. */
  autoHideMs?: number;
  action?: { id: string; label: string };
};

const WEIGHT: Record<NoticeSeverity, number> = { critical: 0, important: 1, info: 2 };

export function visibleNotices(list: readonly HudNotice[], dismissed: ReadonlySet<string>, max = 1): { shown: HudNotice[]; hidden: HudNotice[] } {
  const seen = new Set<string>();
  const live: HudNotice[] = [];
  for (const n of list) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    if (dismissed.has(n.id)) continue;
    live.push(n);
  }
  const ordered = live.map((n, i) => ({ n, i })).sort((a, b) => WEIGHT[a.n.severity] - WEIGHT[b.n.severity] || a.i - b.i).map((x) => x.n);
  const critical = ordered.filter((n) => n.severity === "critical").length;
  const room = Math.max(max, critical); // critical messages are never cut by the limit
  return { shown: ordered.slice(0, room), hidden: ordered.slice(room) };
}

/** Forget dismissals of problems that are gone, so the same problem coming back is shown again. */
export function pruneDismissed(dismissed: ReadonlySet<string>, activeIds: readonly string[]): ReadonlySet<string> {
  const active = new Set(activeIds);
  const kept = [...dismissed].filter((id) => active.has(id));
  return kept.length === dismissed.size ? dismissed : new Set(kept);
}

export type NavStatusInput = {
  /** The navigation session's own status line (e.g. "Recalculating…"), its tone, or null. */
  session: { id: string; text: string; tone: "error" | "warn" | "info" } | null;
  /** A position-quality problem (stale, rough, poor) to state, or null. */
  signal: string | null;
  /** GPS too vague to place the traveller on the road. */
  uncertain: boolean;
  /** A one-off note from navigation (e.g. "Route updated"), dismissible. */
  notice: string | null;
};

/** The messages navigation wants to show, as notices. A vague position pauses guidance, so it is important and does not go away by itself. */
export function navNotices(i: NavStatusInput): HudNotice[] {
  const out: HudNotice[] = [];
  if (i.uncertain) out.push({ id: "gps-uncertain", severity: "important", text: "GPS is too vague to place you on the road, so guidance is paused.", dismissible: false });
  if (i.signal) out.push({ id: "gps-signal", severity: "important", text: i.signal, dismissible: false });
  if (i.session) out.push({ id: i.session.id, severity: i.session.tone === "info" ? "info" : "important", text: i.session.text, dismissible: false });
  if (i.notice) out.push({ id: "nav-notice", severity: "info", text: i.notice, dismissible: true, autoHideMs: 12_000 });
  return out;
}

/**
 * Which alert cards to put on the map: one at a time, newest first, but every critical (level 1) alert is always shown, never cut for
 * room. The rest are not lost: they are counted and listed in the route info sheet.
 */
export function visibleAlerts<T extends { level: number }>(active: readonly T[], max = 1): { shown: T[]; hiddenCount: number } {
  const critical = active.filter((a) => a.level === 1);
  const rest = active.filter((a) => a.level !== 1);
  const shown = [...critical, ...rest].slice(0, Math.max(max, critical.length));
  return { shown, hiddenCount: active.length - shown.length };
}
