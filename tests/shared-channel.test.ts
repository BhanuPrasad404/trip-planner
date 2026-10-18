// The drive (app-wide) and the plan can watch the same trip at once. Supabase returns the SAME channel for the same topic and throws
// when listeners are added after it joined, so every screen shares one channel per trip, and it closes only when the last one leaves.
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
import { joinStopsChannel } from "@/lib/client/use-trip-changes";

const fakeSb = () => {
  const handlers: { kind: string; fn: () => void }[] = [];
  let created = 0; const removed: unknown[] = [];
  const channel = { on: (kind: string, _f: unknown, fn: () => void) => { handlers.push({ kind, fn }); return channel; }, subscribe: () => channel };
  const sb = { channel: () => { created++; return channel; }, removeChannel: async (c: unknown) => { removed.push(c); } };
  return { sb: sb as never, handlers, created: () => created, removed };
};

describe("one shared stops channel per trip", () => {
  it("a second screen joins the SAME channel (no second subscription), and both hear changes", () => {
    const f = fakeSb(); const heard: string[] = [];
    const leaveDrive = joinStopsChannel(f.sb, "t1", () => heard.push("drive"), true);
    const leavePlan = joinStopsChannel(f.sb, "t1", () => heard.push("plan"), false);
    expect(f.created()).toBe(1);
    f.handlers.find((h) => h.kind === "broadcast")!.fn();
    expect(heard.sort()).toEqual(["drive", "plan"]);
    heard.length = 0;
    f.handlers.find((h) => h.kind === "postgres_changes")!.fn();
    expect(heard).toEqual(["drive"]); // row events only for screens that asked for them
    leavePlan();
    expect(f.removed).toHaveLength(0); // the drive still listens: leaving the plan must not cut it off
    leaveDrive();
    expect(f.removed).toHaveLength(1);
    joinStopsChannel(f.sb, "t1", () => {}, false)();
    expect(f.created()).toBe(2); // a fresh channel after everyone left
  });
});
