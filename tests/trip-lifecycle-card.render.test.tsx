import { choose } from "./helpers/select";
import { TimePicker } from "@/components/ui/TimePicker";
import { createElement, act, type ReactNode } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lifecycle } from "@/lib/trip/lifecycle";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
import { TripLifecycleCard } from "@/components/TripLifecycleCard";

const text = (n: ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(text).join(""));
const T = "t1";
const never: Lifecycle = { kind: "expired-never-started" };
const started: Lifecycle = { kind: "expired-started", done: 2, skipped: 1, remaining: 2, stops: 5 };

describe("TripLifecycleCard: what to do with a trip whose real life and planned dates have come apart", () => {
  let r: TestRenderer.ReactTestRenderer; let store: Record<string, string>; let sent: { url: string; body: Record<string, unknown> }[]; let reply: () => Response;
  beforeEach(() => {
    store = {}; sent = []; router.push.mockClear(); router.refresh.mockClear();
    reply = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } }, addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { sent.push({ url, body: JSON.parse(String(init.body)) }); return reply(); }));
  });
  afterEach(() => { act(() => r?.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });
  const mount = async (lifecycle: Lifecycle, isOwner = true, plannedLabel: string | null = "1 Oct – 2 Oct") => { await act(async () => { r = TestRenderer.create(createElement(TripLifecycleCard, { tripId: T, lifecycle, isOwner, plannedLabel })); }); };
  const btn = (label: string) => r.root.findAll((n) => n.type === "button" && text(n).includes(label))[0];
  const press = async (label: string) => { const b = btn(label); if (!b) throw new Error(`no button "${label}"`); await act(async () => { b.props.onClick(); await Promise.resolve(); await Promise.resolve(); }); };
  const all = () => text(r.root);

  it("says nothing for a normal trip", async () => { await mount({ kind: "normal" }); expect(r.toJSON()).toBeNull(); });

  describe("planned dates passed, never started", () => {
    it("explains in plain words, does not call it completed, and offers resume, reschedule, keep and call-off", async () => {
      await mount(never);
      expect(all()).toContain("The planned dates (1 Oct – 2 Oct) have passed"); expect(all()).toContain("never started"); expect(all()).toContain("isn't marked as completed");
      for (const l of ["Resume now", "Keep saved plan", "Call it off"]) expect(btn(l)).toBeTruthy();
      const resched = r.root.findAll((n) => n.type === "a" && text(n) === "Reschedule")[0];
      expect(resched.props.href).toBe("/trips/t1#dates-heading"); // the existing dates panel: planned dates change only there, by the owner
      expect(r.root.findAll((n) => n.props.role === "region" && n.props["aria-label"] === "Trip status")).toHaveLength(1);
    });
    it("a member is told only the owner can change it, and gets no buttons", async () => {
      await mount(never, false);
      expect(all()).toContain("Only the trip owner can change this."); expect(r.root.findAll((n) => n.type === "button")).toHaveLength(0);
    });
    it("does not need dates to be shown (a trip can have none)", async () => { await mount(never, true, null); expect(all()).toContain("The planned dates have passed"); });

    it("Resume now asks when you are leaving and how long you can travel, and says what will and will not happen", async () => {
      await mount(never); await press("Resume now");
      expect(all()).toContain("When are you leaving?"); expect(all()).toContain("How long can you travel?");
      expect(all()).toContain("Your planned dates stay as they are"); expect(all()).toContain("Nothing starts by itself"); expect(all()).toContain("Start drive");
      expect(all()).toContain("or from the place you choose if GPS isn't available"); expect(all()).toContain("you decide");
    });
    it("leaving now with 4 hours: the day is planned to end 4 hours from the current time; resuming records ONLY that, then goes to Live (it does not start navigation)", async () => {
      vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T10:30:00+05:30")); // 10:30 India time, on any computer
      await mount(never); await press("Resume now");
      expect(all()).toContain("wrap up by"); expect(all()).toContain("2:30 pm");
      await press("Resume trip");
      expect(sent).toEqual([{ url: "/api/trips/t1/lifecycle", body: { action: "resume", day_end_min: 14 * 60 + 30 } }]); // nothing about dates, stops or navigation is sent
      expect(router.push).toHaveBeenCalledWith("/trips/t1/live"); expect(router.refresh).toHaveBeenCalled();
    });
    it("leaving later today at 17:00 for 4 hours plans to wrap up by 9 pm", async () => {
      await mount(never); await press("Resume now");
      const time = r.root.findAll((n) => n.type === TimePicker)[0];
      await act(async () => { time.props.onChange("17:00"); });
      await act(async () => { choose(r.root, "lifecycle-hours", "4"); });
      expect(all()).toContain("9:00 pm");
      await press("Resume trip"); expect(sent[0].body).toEqual({ action: "resume", day_end_min: 21 * 60 });
    });
    it("an invalid departure time cannot be submitted, and says why", async () => {
      await mount(never); await press("Resume now");
      await act(async () => { r.root.findAll((n) => n.type === TimePicker)[0].props.onChange(""); });
      expect(all()).toContain("Choose a valid departure time."); expect(btn("Resume trip").props.disabled).toBe(true);
      await press("Resume trip"); expect(sent).toEqual([]);
    });
    it("if resuming fails the traveller stays where they are, sees the real reason, and nothing navigates", async () => {
      reply = () => new Response(JSON.stringify({ error: "This needs a database update that hasn't been applied yet, so the trip can't be changed right now. Nothing was lost." }), { status: 503 });
      await mount(never); await press("Resume now"); await press("Resume trip");
      expect(all()).toContain("hasn't been applied yet"); expect(router.push).not.toHaveBeenCalled(); expect(all()).toContain("Resume trip"); // still on the form
    });
    it("a double tap sends one request", async () => {
      await mount(never); await press("Resume now");
      await act(async () => { btn("Resume trip").props.onClick(); btn("Resume trip").props.onClick(); await Promise.resolve(); await Promise.resolve(); });
      expect(sent).toHaveLength(1);
    });
    it("'Not now' closes the form without sending anything", async () => {
      await mount(never); await press("Resume now"); await press("Not now");
      expect(all()).not.toContain("When are you leaving?"); expect(sent).toEqual([]); expect(btn("Resume now")).toBeTruthy();
    });
    it("Keep saved plan folds the card to one quiet line, remembers it on this device, changes nothing on the server, and can be undone", async () => {
      await mount(never); await press("Keep saved plan");
      expect(all()).toContain("saved plan kept as it is"); expect(sent).toEqual([]); expect(JSON.parse(store["tm:lifecycle-keep:t1"])).toEqual({ keep: true });
      expect(btn("Resume")).toBeTruthy(); await press("Show options");
      expect(all()).toContain("have passed"); expect(btn("Resume now")).toBeTruthy();
    });
    it("calling it off asks first, says that nothing is lost, and then records only the decision", async () => {
      await mount(never); await press("Call it off");
      expect(all()).toContain("Call off this trip?"); expect(all()).toContain("your memories are all kept"); expect(sent).toEqual([]);
      await press("Yes, call it off"); expect(sent).toEqual([{ url: "/api/trips/t1/lifecycle", body: { action: "cancel" } }]); expect(router.refresh).toHaveBeenCalled();
    });
    it("'Keep it' backs out of calling it off", async () => { await mount(never); await press("Call it off"); await press("Keep it"); expect(sent).toEqual([]); expect(btn("Resume now")).toBeTruthy(); });
  });

  describe("planned dates passed, but the trip is under way", () => {
    it("preserves and reports the progress, and offers continue, revise and finish", async () => {
      await mount(started);
      expect(all()).toContain("this trip is under way"); expect(all()).toContain("2 of 5 stops done, 1 skipped"); expect(all()).toContain("your progress is kept"); expect(all()).toContain("2 stops left");
      expect(btn("Continue from the next stop")).toBeTruthy(); expect(btn("Finish trip")).toBeTruthy();
      expect(r.root.findAll((n) => n.type === "a" && text(n) === "Revise the rest")[0].props.href).toBe("/trips/t1/plan");
    });
    it("continuing opens the same resume form and records the same decision", async () => {
      await mount(started); await press("Continue from the next stop"); expect(all()).toContain("Continue from your next stop");
      await act(async () => { r.root.findAll((n) => n.type === TimePicker)[0].props.onChange("09:00"); });
      await press("Resume trip"); expect(sent[0].body).toEqual({ action: "resume", day_end_min: 13 * 60 });
    });
    it("finishing asks first and keeps everything", async () => {
      await mount(started); await press("Finish trip"); expect(all()).toContain("Finish this trip?"); expect(all()).toContain("Your stops, what you marked done and skipped, and your memories are all kept");
      await press("Yes, finish it"); expect(sent).toEqual([{ url: "/api/trips/t1/lifecycle", body: { action: "finish" } }]);
    });
    it("with nothing left to do it only offers to finish (nothing to continue or revise)", async () => {
      await mount({ ...started, remaining: 0, done: 4, skipped: 1, stops: 5 });
      expect(all()).toContain("Nothing is left to do."); expect(btn("Continue from the next stop")).toBeUndefined(); expect(r.root.findAll((n) => n.type === "a")).toHaveLength(0); expect(btn("Finish trip")).toBeTruthy();
    });
    it("a member sees the progress and is told only the owner can change it", async () => {
      await mount(started, false); expect(all()).toContain("2 of 5 stops done"); expect(all()).toContain("Only the trip owner can change this."); expect(r.root.findAll((n) => n.type === "button")).toHaveLength(0);
    });
  });

  describe("resumed and closed trips", () => {
    it("a resumed trip says so, says the planned dates are unchanged, links to Live (it does not start anything) and lets the owner finish it", async () => {
      await mount({ kind: "resumed", since: "2026-10-15T04:00:00.000Z", remaining: 3 });
      expect(all()).toContain("Resumed"); expect(all()).toContain("3 stops to go"); expect(all()).toContain("Planned dates (1 Oct – 2 Oct) are unchanged.");
      expect(r.root.findAll((n) => n.type === "a" && text(n) === "Open Live trip")[0].props.href).toBe("/trips/t1/live");
      await press("Finish trip"); await press("Yes, finish it"); expect(sent[0].body).toEqual({ action: "finish" });
    });
    it("a resumed trip with nothing left says every stop is done or skipped", async () => {
      await mount({ kind: "resumed", since: "2026-10-15T04:00:00.000Z", remaining: 0 }); expect(all()).toContain("every stop is done or skipped");
    });
    it("a finished trip is history: stops, progress and memories kept, nothing restarts by itself; the owner may reopen it", async () => {
      await mount({ kind: "closed", reason: "finished", at: "2026-10-10T00:00:00.000Z" });
      expect(all()).toContain("This trip is finished"); expect(all()).toContain("stops, progress and memories are kept"); expect(all()).toContain("nothing restarts by itself");
      await press("Reopen this trip"); expect(sent).toEqual([{ url: "/api/trips/t1/lifecycle", body: { action: "reopen" } }]); expect(router.refresh).toHaveBeenCalled();
    });
    it("a cancelled trip says it was called off, and a member cannot reopen it", async () => {
      await mount({ kind: "closed", reason: "cancelled", at: "2026-10-10T00:00:00.000Z" }, false);
      expect(all()).toContain("This trip was called off"); expect(all()).toContain("Only the trip owner can change this."); expect(btn("Reopen")).toBeUndefined();
    });
  });
});
