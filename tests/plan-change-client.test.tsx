/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are read as loose JSON, as the server receives them */
// Phase 3 on the phone: the plan-change hook (ask, approve, decline, undo, stay quiet) and what the card says. Nothing here changes a plan
// except an approve, and every refusal reaches the traveller in words.
import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { NUDGE_QUIET_MS, nudgeKey, usePlanChange, type ProposalDTO, type ProposeAnswer } from "@/lib/client/use-plan-change";
import { PlanChangeCard, staleHeadline } from "@/components/PlanChangeCard";
import { PendingSuggestions } from "@/components/PendingSuggestions";
import type { PendingSuggestion } from "@/lib/client/use-plan-change";

const TRIP = "trip-1";
const prop = (o: Partial<ProposalDTO> = {}): ProposalDTO => ({
  strategy: "tomorrow", label: "Start tomorrow morning", feasible: true, days: [], changes: [{ id: "a", name: "Vijayawada", kind: "moved", from: { day: 1, order: 1, time: "14:00" }, to: { day: 2, order: 1, time: "13:40" }, reason: "Moved from Day 1 to Day 2; it would be reached after dark." }],
  removals: [], notPlaced: [], atRisk: [], conditions: [], limitations: [], bookingConflicts: [], night: { arrivals: 0, drives: 0 }, dates: { startDate: "2026-11-01", numDays: 5, startShiftDays: 0, extraDays: 0 },
  unresolved: ["Travel times are estimates, not guarantees, and road conditions and traffic are not known."], summary: "1 stop would move to another day.", rev: 7, canApprove: true, ...o,
});
const answer = (proposals: ProposalDTO[], o: Partial<ProposeAnswer> = {}): ProposeAnswer => ({ baseRev: 1, stale: { kind: "late-departure", minutesLate: 600, firstStop: "Vijayawada" }, proposals, nowDay: 1, journey: "awaiting-departure", ...o });

let pendingBody: unknown = { ok: true, isOwner: true, pending: [] };
let store: Record<string, string>; let calls: { url: string; body: Record<string, any> }[]; let replies: { status: number; body: unknown }[]; let offline: boolean;
beforeEach(() => {
  store = {}; calls = []; replies = []; offline = false; pendingBody = { ok: true, isOwner: true, pending: [] };
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } }, addEventListener: () => {}, removeEventListener: () => {}, setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (i: number) => clearTimeout(i) });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (offline) throw new TypeError("Failed to fetch");
    // The waiting-suggestions list is read when the page opens; it is not one of the calls these tests are about.
    if (url.endsWith("/replan/pending")) return { ok: true, status: 200, json: async () => pendingBody };
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    const r = replies.shift() ?? { status: 200, body: { ok: true } };
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("usePlanChange", () => {
  let api!: ReturnType<typeof usePlanChange>; let r: TestRenderer.ReactTestRenderer; let changed = 0;
  let position: { lat: number; lng: number } | null = null;
  const Probe = () => { api = usePlanChange({ tripId: TRIP, localDate: "2026-11-01", localTime: "18:30", position, onChanged: () => { changed++; }, now: () => Date.now() }); return null; };
  const mount = async () => { changed = 0; await act(async () => { r = TestRenderer.create(createElement(Probe)); }); };
  afterEach(() => { act(() => r?.unmount()); position = null; });

  it("starts quiet: nothing is asked, nothing is changed", async () => {
    await mount();
    expect(api.status).toBe("idle"); expect(calls).toEqual([]); expect(api.answer).toBeNull();
  });
  it("asking sends the situation (and the position only when there is one) and shows the options; nothing changes", async () => {
    position = { lat: 17.4, lng: 78.5 };
    await mount();
    replies.push({ status: 200, body: answer([prop()]) });
    await act(async () => { await api.ask(); });
    expect(calls[0].url).toBe(`/api/trips/${TRIP}/replan/propose`);
    expect(calls[0].body).toMatchObject({ local_date: "2026-11-01", local_time: "18:30", night_driving: false, lat: 17.4, lng: 78.5 });
    expect(api.status).toBe("ready"); expect(api.answer?.proposals).toHaveLength(1);
    expect(changed).toBe(0);
  });
  it("without a position it sends none", async () => {
    await mount(); replies.push({ status: 200, body: answer([]) });
    await act(async () => { await api.ask(); });
    expect(calls[0].body).not.toHaveProperty("lat");
  });
  it("night driving and 'keep it' are asked for again, not guessed", async () => {
    await mount(); replies.push({ status: 200, body: answer([prop()]) }, { status: 200, body: answer([prop()]) });
    await act(async () => { await api.ask({ nightDriving: true }); });
    expect(calls[0].body.night_driving).toBe(true);
    await act(async () => { await api.ask({ keep: ["stop-9"] }); });
    expect(calls[1].body).toMatchObject({ night_driving: true, keep: ["stop-9"] }); // the earlier choice is remembered
  });
  it("approving applies that one suggestion, tells the screen to reload, and offers undo", async () => {
    await mount(); replies.push({ status: 200, body: answer([prop()]) }, { status: 200, body: { ok: true, rev: 9, changed: 3 } });
    await act(async () => { await api.ask(); });
    await act(async () => { await api.approve(7); });
    expect(calls[1]).toMatchObject({ url: `/api/trips/${TRIP}/replan/decide`, body: { proposal_rev: 7, decision: "approve" } });
    expect(changed).toBe(1);
    expect(api.applied).toEqual({ rev: 9, label: "Start tomorrow morning", changed: 3 });
    expect(api.answer).toBeNull();
  });
  it("a stale answer is refused in words and the options are asked for again so they are true now", async () => {
    await mount(); replies.push({ status: 200, body: answer([prop()]) }, { status: 409, body: { error: "Your plan has changed since this was suggested.", code: "stale" } }, { status: 200, body: answer([prop({ rev: 12 })]) });
    await act(async () => { await api.ask(); });
    await act(async () => { await api.approve(7); });
    expect(changed).toBe(0); expect(api.applied).toBeNull();
    expect(calls).toHaveLength(3); expect(calls[2].url).toMatch(/propose$/);
    expect(api.answer?.proposals[0].rev).toBe(12);
  });
  it("offline: a plain message, nothing changed, the options stay", async () => {
    await mount(); replies.push({ status: 200, body: answer([prop()]) });
    await act(async () => { await api.ask(); });
    offline = true;
    await act(async () => { await api.approve(7); });
    expect(api.error).toMatch(/No connection\. Nothing was changed/); expect(changed).toBe(0); expect(api.answer).not.toBeNull();
  });
  it("declining sets that suggestion aside and changes nothing", async () => {
    await mount(); replies.push({ status: 200, body: answer([prop(), prop({ rev: 8, strategy: "extend", label: "Extend the trip" })]) }, { status: 200, body: { ok: true } });
    await act(async () => { await api.ask(); });
    await act(async () => { await api.decline(7); });
    expect(calls[1].body).toEqual({ proposal_rev: 7, decision: "reject" });
    expect(api.answer?.proposals.map((p) => p.rev)).toEqual([8]); expect(changed).toBe(0);
  });
  it("undo takes back the change just approved, and reloads", async () => {
    await mount(); replies.push({ status: 200, body: answer([prop()]) }, { status: 200, body: { ok: true, rev: 9, changed: 1 } }, { status: 200, body: { ok: true, rev: 10 } });
    await act(async () => { await api.ask(); }); await act(async () => { await api.approve(7); });
    await act(async () => { await api.undo(); });
    expect(calls[2]).toMatchObject({ url: `/api/trips/${TRIP}/replan/undo`, body: { rev: 9 } });
    expect(api.applied).toBeNull(); expect(changed).toBe(2);
  });
  it("an undo that is refused says why and keeps the change", async () => {
    await mount(); replies.push({ status: 200, body: answer([prop()]) }, { status: 200, body: { ok: true, rev: 9, changed: 1 } }, { status: 409, body: { error: "Your stops have changed since that was approved.", code: "stale" } });
    await act(async () => { await api.ask(); }); await act(async () => { await api.approve(7); });
    await act(async () => { await api.undo(); });
    expect(api.error).toMatch(/changed since/); expect(api.applied).not.toBeNull();
  });
  it("'keep my plan' is asked once: quiet for this situation for 12 hours, not for a different one", async () => {
    await mount();
    expect(api.quiet("late-departure:2026-11-01:1")).toBe(false);
    act(() => api.dismissNudge("late-departure:2026-11-01:1"));
    expect(api.quiet("late-departure:2026-11-01:1")).toBe(true);
    expect(api.quiet("missed-day:2026-11-01:1")).toBe(false);
    expect(api.quiet(null)).toBe(false);
    expect(JSON.parse(store[nudgeKey(TRIP)]).key).toBe("late-departure:2026-11-01:1");
    vi.setSystemTime(1_800_000_000_000 + NUDGE_QUIET_MS + 1);
    expect(api.quiet("late-departure:2026-11-01:1")).toBe(false);
  });
  it("nothing is asked until the clock is known", async () => {
    const Wait = () => { api = usePlanChange({ tripId: TRIP, localDate: null, localTime: null, position: null, onChanged: () => {} }); return null; };
    await act(async () => { r = TestRenderer.create(createElement(Wait)); });
    await act(async () => { await api.ask(); });
    expect(calls).toEqual([]);
  });
});

describe("the card", () => {
  const noop = () => {};
  const base = { staleness: null, forceOpen: false, closed: false, hasOpenStops: true, status: "idle" as const, answer: null as ProposeAnswer | null, error: null, busy: null, nightDriving: false, applied: null, quiet: false, onAsk: noop, onApprove: noop, onDecline: noop, onUndo: noop, onClose: noop, onCloseApplied: noop, onKeepPlan: noop };
  const html = (o: Partial<Parameters<typeof PlanChangeCard>[0]> = {}) => renderToStaticMarkup(createElement(PlanChangeCard, { ...base, ...o }));

  it("says nothing when the plan matches what is happening, or when the traveller said to keep it", () => {
    expect(html()).toBe("");
    expect(html({ staleness: { kind: "late-departure", minutesLate: 90, firstStop: "A" }, quiet: true })).toBe("");
  });
  it("late departure: says it plainly, that nothing was changed, and offers options and keeping the plan", () => {
    const h = html({ staleness: { kind: "late-departure", minutesLate: 600, firstStop: "Vijayawada" } });
    expect(h).toContain("You haven&#x27;t set off yet"); expect(h).toContain("about 10 h ago"); expect(h).toContain("Nothing has been changed");
    expect(h).toContain("See my options"); expect(h).toContain("Keep my plan as it is"); expect(h).toContain("min-h-11");
  });
  it("missed day and running behind are worded for what happened, and never claim anything was completed", () => {
    expect(staleHeadline({ kind: "missed-day", missedDays: 2, firstDay: 1 })).toMatchObject({ title: "2 planned days went by" });
    expect(staleHeadline({ kind: "missed-day", missedDays: 2, firstDay: 1 }).body).toMatch(/not marked done and none have been removed/);
    expect(staleHeadline({ kind: "missed-day", missedDays: 1, firstDay: 1 }).title).toBe("A planned day went by");
    expect(staleHeadline({ kind: "running-behind", minutesBehind: 135, stop: "Fort" }).body).toMatch(/about 2 h 15 min behind at Fort/);
  });
  it("a closed trip, or a trip with nothing left to do, shows nothing", () => {
    const stale = { kind: "late-departure" as const, minutesLate: 90, firstStop: "A" };
    expect(html({ staleness: stale, closed: true })).toBe("");
    expect(html({ staleness: stale, hasOpenStops: false })).toBe("");
  });
  it("options: each says what it does and what changes; the one that doesn't work is marked and has no approve button", () => {
    const h = html({ status: "ready", answer: answer([prop({ initiallyOpen: undefined } as never), prop({ strategy: "keep-end", label: "Keep the original end date", feasible: false, canApprove: false, rev: null, summary: "This option doesn't work: Araku Valley can't be fitted in the days available.", notPlaced: [{ id: "x", name: "Araku Valley", reason: "It doesn't fit in the days available." }] })]), initiallyOpen: 7 });
    expect(h).toContain("Start tomorrow morning"); expect(h).toContain("Keep the original end date"); expect(h).toContain("Doesn&#x27;t work");
    expect(h).toContain("What changes"); expect(h).toContain("Moved from Day 1 to Day 2"); expect(h).toContain("What we&#x27;re unsure of"); expect(h).toContain("not guarantees");
    expect(h.match(/Use this plan/g)).toHaveLength(1); // only the one that works
    expect(h).toContain("Not this one"); expect(h).toContain("I&#x27;m happy to drive at night");
  });
  it("what would go back to Ideas is stated as not deleted, with a way to keep it; bookings and risks are shown", () => {
    const o = prop({ strategy: "keep-end", label: "Keep the original end date", changes: [{ id: "k", name: "Kailasagiri", kind: "proposed-removal", from: { day: 4, order: 1, time: "10:00" }, to: { day: null, order: null, time: null }, reason: "It is optional and the days left are not enough for everything. It would go back to your ideas, not be deleted." }], removals: [{ id: "k", name: "Kailasagiri", reason: "optional" }], bookingConflicts: [{ id: "h", name: "Hotel", why: "Hotel Sai is fixed for Day 3, and this plan puts it on Day 4.", confirmed: true }], atRisk: [{ id: "v", name: "Vijayawada", why: "You'd be driving at night to reach it." }], night: { arrivals: 1, drives: 1 } });
    const h = html({ status: "ready", answer: answer([o]), initiallyOpen: 7 });
    expect(h).toContain("go back to your ideas, not be deleted"); expect(h).toContain("Keep it instead"); expect(h).toContain("Back to your ideas");
    expect(h).toContain("Your bookings"); expect(h).toContain("fixed for Day 3"); expect(h).toContain("Worth checking"); expect(h).toContain("Night arrival"); expect(h).toContain("Bookings affected");
  });
  it("working, failing and having set everything aside are each said", () => {
    expect(html({ status: "asking", forceOpen: true })).toContain("Working out your options");
    expect(html({ status: "error", forceOpen: true, error: "Couldn't work out your options. Nothing was changed." })).toContain("Nothing was changed");
    expect(html({ status: "ready", answer: answer([]) })).toContain("Your plan hasn&#x27;t changed");
  });
  it("after approving: what happened, that the original is kept, and Undo", () => {
    const h = html({ applied: { rev: 9, label: "Start tomorrow morning", changed: 3 } });
    expect(h).toContain("Your plan is updated: Start tomorrow morning."); expect(h).toContain("3 stops changed"); expect(h).toContain("original plan is still saved"); expect(h).toContain("Undo this change");
    expect(html({ applied: { rev: 9, label: "X", changed: 0 } })).toContain("No stop needed to move.");
  });
  it("long names wrap instead of widening the screen", () => {
    const h = html({ status: "ready", answer: answer([prop()]), initiallyOpen: 7 });
    expect(h).toContain("break-words");
  });
});

// ── Owner-only approval on the screen ──

describe("owner-only approval on the screen", () => {
  const noop = () => {};
  const base = { staleness: null, forceOpen: false, closed: false, hasOpenStops: true, status: "ready" as const, error: null, busy: null, nightDriving: false, applied: null, quiet: false, onAsk: noop, onApprove: noop, onDecline: noop, onUndo: noop, onClose: noop, onCloseApplied: noop, onKeepPlan: noop };
  const member = answer([prop({ canApprove: false, canSuggest: true })], { isOwner: false });
  const html = (o: Partial<Parameters<typeof PlanChangeCard>[0]>) => renderToStaticMarkup(createElement(PlanChangeCard, { ...base, answer: member, ...o }));

  it("a member sees no approve or decline buttons, only 'Suggest this to the trip owner', and why", () => {
    const h = html({ isOwner: false, suggested: [], onSuggest: noop });
    expect(h).not.toContain("Use this plan"); expect(h).not.toContain("Not this one");
    expect(h).toContain("Suggest this to the trip owner"); expect(h).toContain("Only the trip owner can approve changes to the shared plan");
  });
  it("once suggested, it says so instead of offering it again", () => {
    const h = html({ isOwner: false, suggested: [7], onSuggest: noop });
    expect(h).toContain("Suggested to the trip owner"); expect(h).not.toContain(">Suggest this to the trip owner<");
  });
  it("the owner sees approve and decline and nothing about suggesting", () => {
    const h = html({ isOwner: true, answer: answer([prop()], { isOwner: true }) });
    expect(h).toContain("Use this plan"); expect(h).toContain("Not this one"); expect(h).not.toContain("Suggest this to the trip owner");
  });

  const sug = (o: Partial<PendingSuggestion> = {}): PendingSuggestion => ({ rev: 7, suggestedBy: { id: "m1", name: "Anil" }, mine: false, createdAt: "2026-11-02T10:00:00Z", proposal: prop({ rev: 7 }), ...o });
  const pend = (o: Partial<Parameters<typeof PendingSuggestions>[0]> = {}) => renderToStaticMarkup(createElement(PendingSuggestions, { pending: [sug()], isOwner: true, busy: null, error: null, onApprove: noop, onDecline: noop, ...o }));
  it("the owner is told a change is waiting, who suggested it, that nothing has changed, and gets the buttons", () => {
    const h = pend();
    expect(h).toContain("A change is waiting for you"); expect(h).toContain("Suggested by Anil"); expect(h).toContain("Nothing has changed until you approve it");
    expect(h).toContain("Approve this change"); expect(h).toContain("Decline"); expect(h).toContain("min-h-11");
  });
  it("several waiting changes are counted", () => {
    expect(pend({ pending: [sug(), sug({ rev: 8 })] })).toContain("2 changes are waiting for you");
  });
  it("a member sees that it is waiting for the owner, and has no buttons; the suggester sees it as theirs", () => {
    const h = pend({ isOwner: false, pending: [sug({ mine: true })] });
    expect(h).toContain("A change has been suggested to the trip owner"); expect(h).toContain("Only the trip owner can approve or decline"); expect(h).toContain("Suggested by you");
    expect(h).not.toContain("Approve this change"); expect(h).not.toContain("Decline");
  });
  it("shows nothing when nothing is waiting, and a refusal in words", () => {
    expect(pend({ pending: [] })).toBe("");
    expect(pend({ error: "Only the trip owner can approve, decline or undo changes to the shared plan." })).toContain("Only the trip owner can approve, decline or undo");
  });
});

describe("usePlanChange: suggesting and what is waiting", () => {
  let api!: ReturnType<typeof usePlanChange>; let r: TestRenderer.ReactTestRenderer;
  const Probe = () => { api = usePlanChange({ tripId: TRIP, localDate: "2026-11-01", localTime: "18:30", position: null, onChanged: () => {}, now: () => Date.now() }); return null; };
  afterEach(() => { act(() => r?.unmount()); });

  it("reads what is waiting when the page opens (and who the owner is)", async () => {
    pendingBody = { ok: true, isOwner: false, pending: [{ rev: 7, suggestedBy: { id: "m1", name: "Anil" }, mine: false, createdAt: null, proposal: prop({ rev: 7 }) }] };
    await act(async () => { r = TestRenderer.create(createElement(Probe)); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(api.isOwner).toBe(false); expect(api.pending.map((p) => p.rev)).toEqual([7]);
  });
  it("suggesting sends one event about that stored change (no schedule), and remembers it was sent", async () => {
    pendingBody = { ok: true, isOwner: false, pending: [] };
    await act(async () => { r = TestRenderer.create(createElement(Probe)); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    await act(async () => { await api.suggest(7); });
    expect(calls[0].url).toBe(`/api/trips/${TRIP}/events`);
    expect(calls[0].body).toMatchObject({ kind: "revision_proposed", source: "manual", meta: { rev: 7, suggested: true } });
    expect(Object.keys(calls[0].body)).not.toContain("snapshot"); expect(JSON.stringify(calls[0].body)).not.toMatch(/day|order|lat|lng/);
    expect(api.suggested).toEqual([7]);
  });
  it("a refused suggestion is said in words and not remembered as sent", async () => {
    pendingBody = { ok: true, isOwner: false, pending: [] };
    await act(async () => { r = TestRenderer.create(createElement(Probe)); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    replies.push({ status: 404, body: { error: "That proposed change wasn't found." } });
    await act(async () => { await api.suggest(99); });
    expect(api.error).toBe("That proposed change wasn't found."); expect(api.suggested).toEqual([]);
  });
  it("a member who tries to approve is told only the owner can, and the screen is not reloaded as if it worked", async () => {
    pendingBody = { ok: true, isOwner: false, pending: [] };
    let changed = 0;
    const P2 = () => { api = usePlanChange({ tripId: TRIP, localDate: "2026-11-01", localTime: "18:30", position: null, onChanged: () => { changed++; } }); return null; };
    await act(async () => { r = TestRenderer.create(createElement(P2)); });
    replies.push({ status: 403, body: { error: "Only the trip owner can approve, decline or undo changes to the shared plan. Your suggestion is saved for them." } });
    await act(async () => { await api.approve(7); });
    expect(api.error).toMatch(/Only the trip owner can approve/); expect(changed).toBe(0); expect(api.applied).toBeNull();
  });
});
