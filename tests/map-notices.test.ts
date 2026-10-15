import { describe, expect, it } from "vitest";
import { navNotices, pruneDismissed, visibleAlerts, visibleNotices, type HudNotice } from "@/lib/map/notices";

const n = (id: string, severity: HudNotice["severity"], extra: Partial<HudNotice> = {}): HudNotice => ({ id, severity, text: id, dismissible: true, ...extra });
const none = new Set<string>();

describe("visibleNotices: what fits on the map", () => {
  it("shows the most important message first, whatever order they arrived in, and counts the rest", () => {
    const r = visibleNotices([n("a", "info"), n("b", "important"), n("c", "info")], none, 1);
    expect(r.shown.map((x) => x.id)).toEqual(["b"]); expect(r.hidden.map((x) => x.id)).toEqual(["a", "c"]);
  });
  it("keeps arrival order within a severity (nothing jumps around)", () => {
    expect(visibleNotices([n("x", "important"), n("y", "important"), n("z", "important")], none, 2).shown.map((q) => q.id)).toEqual(["x", "y"]);
  });
  it("NEVER hides a critical message to make room, even past the limit", () => {
    const r = visibleNotices([n("i", "info"), n("c1", "critical"), n("c2", "critical"), n("p", "important")], none, 1);
    expect(r.shown.map((x) => x.id)).toEqual(["c1", "c2"]); expect(r.hidden.map((x) => x.id)).toEqual(["p", "i"]);
  });
  it("shows the same problem once, however many times it is reported", () => {
    expect(visibleNotices([n("a", "info"), n("a", "critical")], none, 5).shown).toHaveLength(1);
  });
  it("a dismissed message is gone (acknowledged), also a critical one, and does not count as hidden", () => {
    const r = visibleNotices([n("c", "critical"), n("i", "info")], new Set(["c"]), 1);
    expect(r.shown.map((x) => x.id)).toEqual(["i"]); expect(r.hidden).toEqual([]);
  });
  it("copes with nothing", () => expect(visibleNotices([], none)).toEqual({ shown: [], hidden: [] }));
});

describe("pruneDismissed: a dismissal lasts while the problem lasts", () => {
  it("forgets dismissals of problems that are gone, so the same problem coming back is shown again", () => {
    expect([...pruneDismissed(new Set(["a", "b"]), ["b", "c"])]).toEqual(["b"]);
    expect(pruneDismissed(new Set(["a"]), [])).toEqual(new Set());
  });
  it("returns the very same set when nothing changed (so callers do not loop)", () => {
    const s = new Set(["a"]); expect(pruneDismissed(s, ["a", "z"])).toBe(s);
  });
});

describe("navNotices: what navigation wants to say", () => {
  const base = { session: null, signal: null, uncertain: false, notice: null };
  it("says nothing when all is well", () => expect(navNotices(base)).toEqual([]));
  it("a position too vague to guide is important, stays until resolved, and cannot be dismissed away", () => {
    const [a] = navNotices({ ...base, uncertain: true });
    expect(a).toMatchObject({ id: "gps-uncertain", severity: "important", dismissible: false });
    expect(a.autoHideMs).toBeUndefined();
  });
  it("a position problem outranks the status line; a plain status is only info", () => {
    const list = navNotices({ session: { id: "session:exploring", text: "Looking around", tone: "info" }, signal: "GPS signal is weak", uncertain: false, notice: null });
    expect(visibleNotices(list, none, 1).shown[0].id).toBe("gps-signal");
    expect(list.find((x) => x.id === "session:exploring")?.severity).toBe("info");
  });
  it("a recalculating or error status is important (the traveller needs to know the guidance is not live)", () => {
    for (const tone of ["error", "warn"] as const) expect(navNotices({ ...base, session: { id: "s", text: "t", tone } })[0].severity).toBe("important");
  });
  it("a one-off note is info, dismissible, and tidies itself away; important ones never do", () => {
    const list = navNotices({ session: { id: "s", text: "t", tone: "warn" }, signal: "weak", uncertain: true, notice: "Route updated" });
    expect(list.find((x) => x.id === "nav-notice")).toMatchObject({ severity: "info", dismissible: true, autoHideMs: 12_000 });
    for (const x of list.filter((q) => q.severity !== "info")) expect(x.autoHideMs).toBeUndefined();
  });
});

describe("visibleAlerts", () => {
  const a = (id: string, level: number) => ({ id, level });
  it("one card at a time, newest first, and the rest are counted", () => {
    expect(visibleAlerts([a("1", 2), a("2", 2), a("3", 3)])).toEqual({ shown: [a("1", 2)], hiddenCount: 2 });
  });
  it("every critical alert is shown, never cut for room", () => {
    const r = visibleAlerts([a("t", 2), a("c1", 1), a("c2", 1)]);
    expect(r.shown.map((x) => x.id)).toEqual(["c1", "c2"]); expect(r.hiddenCount).toBe(1);
  });
  it("nothing in, nothing out", () => expect(visibleAlerts([])).toEqual({ shown: [], hiddenCount: 0 }));
});
