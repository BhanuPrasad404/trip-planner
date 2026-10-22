// The drive (app-wide) and the trip's own pages can watch the same trip at once. Supabase returns the SAME channel object for the same
// topic (even one that is still leaving), so every screen shares one channel per trip; it closes a moment after the last one leaves,
// and a screen arriving while the old one is still being removed gets a fresh channel once that is done.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
import { joinStopsChannel } from "@/lib/client/use-trip-changes";
import { LINGER_MS } from "@/lib/client/shared-channel";
import { joinTripStatus } from "@/components/TripGoneWatcher";
import { MEMBERS_CHANGED_BROADCAST, TRIP_DELETED_BROADCAST } from "@/lib/trip/deletion";

type FakeChannel = { topic: string; state: "joined" | "leaving" | "closed"; handlers: { kind: string; event: string; fn: () => void }[] };
/** Like realtime-js: channel(topic) hands back the existing object for that topic until its removal has FINISHED. */
const fakeSb = (opts: { slowRemove?: boolean } = {}) => {
  const list: FakeChannel[] = []; const all: FakeChannel[] = [];
  let finishRemoval: (() => void)[] = [];
  const sb = {
    channel: (topic: string) => {
      const found = list.find((c) => c.topic === topic);
      if (found) return api(found);
      const c: FakeChannel = { topic, state: "closed", handlers: [] };
      list.push(c); all.push(c);
      return api(c);
    },
    removeChannel: async (ch: { raw: FakeChannel }) => {
      ch.raw.state = "leaving";
      const done = () => { ch.raw.state = "closed"; list.splice(list.indexOf(ch.raw), 1); };
      if (opts.slowRemove) await new Promise<void>((r) => finishRemoval.push(() => { done(); r(); })); else done();
      return "ok";
    },
  };
  function api(c: FakeChannel) {
    const a = {
      raw: c,
      on: (kind: string, f: { event: string }, fn: () => void) => { c.handlers.push({ kind, event: f.event, fn }); return a; },
      subscribe: () => { if (c.state === "closed") c.state = "joined"; return a; },
    };
    return a;
  }
  /** A broadcast from the server reaches only a JOINED channel. */
  const deliver = (topic: string, kind: string, event?: string) => all.filter((c) => c.topic === topic && c.state === "joined")
    .forEach((c) => c.handlers.filter((h) => h.kind === kind && (!event || h.event === event)).forEach((h) => h.fn()));
  return { sb: sb as never, all, deliver, finish: () => { const f = finishRemoval; finishRemoval = []; f.forEach((x) => x()); } };
};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe("one shared stops channel per trip", () => {
  it("a second screen joins the SAME channel, and both hear changes; row events only for screens that asked", () => {
    const f = fakeSb(); const heard: string[] = [];
    const leaveDrive = joinStopsChannel(f.sb, "s1", () => heard.push("drive"), true);
    const leavePlan = joinStopsChannel(f.sb, "s1", () => heard.push("plan"), false);
    expect(f.all).toHaveLength(1);
    f.deliver("trip-stops-s1", "broadcast");
    expect(heard.sort()).toEqual(["drive", "plan"]);
    heard.length = 0;
    f.deliver("trip-stops-s1", "postgres_changes");
    expect(heard).toEqual(["drive", "drive"]); // insert + update listeners
    leavePlan(); leaveDrive();
  });
  it("closes only a moment after the LAST screen leaves", async () => {
    const f = fakeSb();
    const leaveA = joinStopsChannel(f.sb, "s2", () => {}, true);
    const leaveB = joinStopsChannel(f.sb, "s2", () => {}, false);
    leaveB();
    vi.advanceTimersByTime(LINGER_MS + 1); await flush();
    expect(f.all[0].state).toBe("joined"); // the drive still listens: leaving the plan must not cut it off
    leaveA();
    expect(f.all[0].state).toBe("joined");
    vi.advanceTimersByTime(LINGER_MS); await flush();
    expect(f.all[0].state).toBe("closed");
    joinStopsChannel(f.sb, "s2", () => {}, false)();
    expect(f.all).toHaveLength(2); // a fresh channel after everyone left
  });
});

describe("the trip-status channel survives the hand-off between the trip layout's watcher and the drive's", () => {
  it("one watcher leaves and the next arrives in the same moment: same joined channel, and a delete hint still arrives", async () => {
    const f = fakeSb(); const heard: string[] = [];
    const leaveLayout = joinTripStatus(f.sb, "t1", "deleted", () => heard.push("layout"));
    leaveLayout(); // the traveller left the trip's pages while driving…
    joinTripStatus(f.sb, "t1", "deleted", () => heard.push("drive")); // …and the drive's own watcher took over
    vi.advanceTimersByTime(LINGER_MS * 2); await flush();
    expect(f.all).toHaveLength(1); expect(f.all[0].state).toBe("joined");
    f.deliver("trip-status-t1", "broadcast", TRIP_DELETED_BROADCAST);
    expect(heard).toEqual(["drive"]);
  });
  it("arriving while the old channel is STILL being removed: a fresh channel once the removal is done, never the leaving one", async () => {
    const f = fakeSb({ slowRemove: true }); const heard: string[] = [];
    joinTripStatus(f.sb, "t2", "members", () => heard.push("old"))();
    vi.advanceTimersByTime(LINGER_MS); await flush();
    expect(f.all[0].state).toBe("leaving");
    const leave = joinTripStatus(f.sb, "t2", "members", () => heard.push("new"));
    expect(f.all).toHaveLength(1); // nothing is added to the leaving channel
    f.finish(); await flush();
    expect(f.all).toHaveLength(2); expect(f.all[1].state).toBe("joined");
    f.deliver("trip-status-t2", "broadcast", MEMBERS_CHANGED_BROADCAST);
    expect(heard).toEqual(["new"]);
    leave();
  });
  it("a screen that comes and goes while a removal is in flight never opens a channel", async () => {
    const f = fakeSb({ slowRemove: true });
    joinTripStatus(f.sb, "t3", "deleted", () => {})();
    vi.advanceTimersByTime(LINGER_MS); await flush();
    joinTripStatus(f.sb, "t3", "deleted", () => {})();
    vi.advanceTimersByTime(LINGER_MS); f.finish(); await flush();
    expect(f.all).toHaveLength(1);
  });
  it("leaving twice is harmless", () => {
    const f = fakeSb();
    const leaveA = joinTripStatus(f.sb, "t4", "deleted", () => {});
    const leaveB = joinTripStatus(f.sb, "t4", "deleted", () => {});
    leaveA(); leaveA();
    vi.advanceTimersByTime(LINGER_MS);
    expect(f.all[0].state).toBe("joined"); // B still there
    leaveB();
  });
});
