import { createElement, act } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateMatrix } from "@/lib/providers/estimate";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let online = true;
vi.mock("@/lib/client/use-connectivity", () => ({ useOnline: () => online }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { PlanFlow } from "@/components/plan/PlanFlow";
import { PollForm } from "@/components/plan/PollForm";
import { GroupPanel } from "@/components/plan/GroupPanel";
import { clearPickerMemory } from "@/components/PlaceSearch";
import { clearFitMeterMemory } from "@/lib/client/use-fit-meter";

const HYD = { id: "gn:1", name: "Hyderabad", lat: 17.385, lng: 78.4867, kind: "city", area: "Telangana", state: "Telangana", source: "geonames", km: 0, calledAs: null };
const place = (said: string, name: string, lat: number, lng: number, status = "sure", reason: string | null = null, alternatives: unknown[] = []) => ({ said, must: false, source: "said", evidence: said, status, reason, place: { id: `x:${name}`, name, lat, lng, kind: "sight", area: "Telangana", state: "Telangana", source: "geonames", km: null, calledAs: null }, alternatives });

let store: Record<string, string>;
let aiAnswer: unknown;
let fetchMock: ReturnType<typeof vi.fn>;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

beforeEach(() => {
  vi.useFakeTimers();
  online = true; store = {}; push.mockClear(); clearPickerMemory(); clearFitMeterMemory();
  aiAnswer = { status: "slow", reading: null, start: null, places: [] };
  vi.stubGlobal("window", { isSecureContext: true, location: { search: "", origin: "https://trailmate.test" }, localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  vi.stubGlobal("document", { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("navigator", { permissions: { query: async () => ({ state: "prompt", addEventListener: () => {}, removeEventListener: () => {} }) }, geolocation: { getCurrentPosition: () => {} } });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    switch (url) {
      case "/api/intake/read": return json({
        understanding: { answers: { days: { value: 4, source: "said", evidence: "4 rojulu" }, group: { value: "friends", source: "said", evidence: "friends" }, interests: { value: ["beaches"], source: "said", evidence: "beaches" } }, places: [], conflicts: [], unbacked: [], scripts: ["Latin"] },
        start: { place: HYD, alternatives: [], from: "text" },
        places: [place("Warangal", "Warangal Fort", 17.95, 79.62), place("Kondapalli", "Kondapalli", 14.53, 77.4, "check", "2 places are called “Kondapalli”. Is it the one in Sri Sathya Sai, Andhra Pradesh?", [{ ...place("x", "Kondapalle", 16.62, 80.54).place, area: "NTR, Andhra Pradesh", km: 260 }])],
      });
      case "/api/intake/ai": return json(aiAnswer);
      case "/api/intake/roads": return json(estimateMatrix(body.points));
      case "/api/intake/season": return json({ climate: null, inSeason: [] });
      case "/api/intake/similar": return json({ suggestions: [], status: "ok", note: "No notable places of the same kind near your trip in the map data." });
      case "/api/place-suggest": return json({ groups: [] });
      case "/api/saved-places": return json({}, 401);
      case "/api/trips": return json({ id: "trip-77" }, 201);
      case "/api/places/bulk": return json({ added: 2 }, 201);
      default: return json({}, 404);
    }
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const textOf = (n: ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(" ")).replace(/\s+/g, " ");
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const buttons = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => n.type === "button");
const click = async (r: TestRenderer.ReactTestRenderer, label: string | RegExp) => {
  const b = buttons(r).find((n) => (typeof label === "string" ? textOf(n).includes(label) : label.test(textOf(n))));
  if (!b) throw new Error(`no button "${label}" in: ${buttons(r).map(textOf).join(" | ")}`);
  await act(async () => { b.props.onClick?.({ preventDefault: () => {} }); });
  await flush(10);
};
async function render(signedIn = false) { let r!: TestRenderer.ReactTestRenderer; await act(async () => { r = TestRenderer.create(createElement(PlanFlow, { signedIn })); }); await flush(); return r; }
async function toUnderstood(r: TestRenderer.ReactTestRenderer) {
  await click(r, "Describe my trip");
  const ta = r.root.find((n) => n.type === "textarea");
  await act(async () => { ta.props.onChange({ target: { value: "4 rojulu Hyderabad nundi, friends tho beaches. Warangal, Kondapalli" } }); });
  await click(r, "Read it");
  await flush(1000);
}

describe("the guided flow — screens", () => {
  it("start: where you start, three ways in, and examples in Indian languages", async () => {
    const r = await render();
    const t = textOf(r.root);
    expect(t).toContain("Starting from");
    for (const s of ["I saw these places", "Describe my trip", "Pick places myself", "4 rojulu Hyderabad nundi"]) expect(t).toContain(s);
  });
  it("words: honest about reel links", async () => {
    const r = await render();
    await click(r, "I saw these places");
    expect(textOf(r.root)).toContain("We can't open Instagram or YouTube links. Paste the place names or the caption instead.");
  });
  it("understood: chips, Sure / Check this with the reason and a Fix, and the fit meter in words", async () => {
    const r = await render();
    await toUnderstood(r);
    const t = textOf(r.root);
    expect(t).toMatch(/Here's what we understood/);
    for (const s of ["4 days", "from Hyderabad", "Friends", "Beaches"]) expect(t).toContain(s);
    expect(t).toContain("Warangal Fort");
    expect(t).toMatch(/Sure/);
    expect(t).toMatch(/Check this/);
    expect(t).toContain("2 places are called “Kondapalli”");
    expect(buttons(r).some((b) => /^Fix/.test(textOf(b).trim()))).toBe(true);
    expect(t).toMatch(/Fits easily in 4 days|Fits, but|Doesn't all fit/);
    expect(t).toContain("Checks driving and time");
  });
  it("AI didn't answer: the message STAYS on screen, with 'Try the AI again'", async () => {
    const r = await render();
    await toUnderstood(r);
    expect(textOf(r.root)).toContain("The AI didn't answer in time. We used what we could read ourselves");
    aiAnswer = { status: "ok", reading: { answers: {}, places: [], unbacked: [] }, start: null, places: [place("Ramappa", "Ramappa Temple", 18.26, 79.94)] };
    await click(r, "Try the AI again");
    await flush(10);
    expect(textOf(r.root)).toContain("Ramappa Temple");
    expect(textOf(r.root)).not.toContain("didn't answer in time");
  });
  it("questions: at most 3, each with the default shown and Skip", async () => {
    const r = await render();
    await toUnderstood(r);
    await click(r, "Continue");
    const cards = r.root.findAll((n) => n.type === "section" && String(n.props["aria-labelledby"] ?? "").startsWith("q-"));
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(3);
    expect(textOf(r.root)).toMatch(/We'll assume:/);
    for (const c of cards) expect(c.findAll((n) => n.type === "button" && /^Skip/.test(textOf(n).trim()))).toHaveLength(1);
  });
  it("a guest signs up at 'Plan my trip': the plan is kept on this phone and the sign-up comes back here", async () => {
    const r = await render(false);
    await toUnderstood(r);
    await click(r, "Continue");
    await click(r, "Skip the rest and use the defaults");
    await click(r, "Sign up and plan my trip");
    expect(push).toHaveBeenCalledWith("/signup?next=%2Fplan%3Fresume%3D1");
    expect(JSON.parse(store["tm:plan-draft:v1"]).draft.places.length).toBe(2);
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/trips")).toBe(false);
  });
  it("signed in: creates the trip with what was understood, adds the found places, opens 'Plan my trip'", async () => {
    const r = await render(true);
    await toUnderstood(r);
    await click(r, "Continue");
    await click(r, "Skip the rest and use the defaults");
    await click(r, "Plan my trip");
    await flush(10);
    const trip = JSON.parse(String((fetchMock.mock.calls.find((c) => c[0] === "/api/trips")![1] as RequestInit).body));
    expect(trip).toMatchObject({ start_city: "Hyderabad", num_days: 4, end_mode: "start", intake: expect.objectContaining({ group: "friends", interests: ["beaches"] }) });
    const bulk = JSON.parse(String((fetchMock.mock.calls.find((c) => c[0] === "/api/places/bulk")![1] as RequestInit).body));
    expect(bulk.trip_id).toBe("trip-77");
    expect(bulk.places.map((p: { name: string }) => p.name)).toEqual(["Warangal Fort", "Kondapalli"]);
    expect(push).toHaveBeenCalledWith("/trips/trip-77/plan?tool=plan");
  });
  it("offline: reading is not attempted and it says why", async () => {
    online = false;
    const r = await render();
    await click(r, "Describe my trip");
    expect(textOf(r.root)).toContain("You're offline. Reading needs the internet");
  });
});

describe("a friend's answer page", () => {
  const renderPoll = async () => { let r!: TestRenderer.ReactTestRenderer; await act(async () => { r = TestRenderer.create(createElement(PollForm, { code: "0123456789abcdef" })); }); await flush(10); return r; };
  it("shows only the trip's name; sends name + 3 choices; thanks them", async () => {
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) => (init?.method === "POST" ? json({ status: "saved" }) : json({ status: "open", trip_name: "Goa with the gang", mine: null, signedIn: false })));
    const r = await renderPoll();
    expect(textOf(r.root)).toContain("Goa with the gang");
    await act(async () => { r.root.find((n) => n.type === "input").props.onChange({ target: { value: "Ravi" } }); });
    await click(r, "Relaxed");
    await click(r, "Food");
    await click(r, "Driving at night");
    await act(async () => { await r.root.find((n) => n.type === "form").props.onSubmit({ preventDefault: () => {} }); });
    await flush(10);
    const sent = JSON.parse(String((fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")![1] as RequestInit).body));
    expect(sent).toEqual({ name: "Ravi", answers: { pace: "relaxed", interests: ["food"], avoid: ["night_driving"] } });
    expect(textOf(r.root)).toMatch(/Thanks, Ravi ?!/);
  });
  it("closed and invalid links say so plainly", async () => {
    fetchMock.mockImplementation(async () => json({ status: "closed", trip_name: "Goa", mine: null, signedIn: false }));
    expect(textOf((await renderPoll()).root)).toContain("isn't taking answers right now");
    fetchMock.mockImplementation(async () => json({ status: "invalid", mine: null, signedIn: false }));
    expect(textOf((await renderPoll()).root)).toContain("This link isn't valid any more");
  });
});

describe("the owner's 'Ask your group' panel", () => {
  it("shares a link (copy / WhatsApp), shows where the group agrees and splits", async () => {
    fetchMock.mockImplementation(async () => json({
      owner: true, link: { code: "0123456789abcdef", open: true },
      answers: [{ id: "a1", name: "Ravi", answers: { pace: "relaxed", interests: ["food"] }, member: false }],
      summary: { count: 4, agree: ["All 4: Relaxed pace"], split: ["Split on pace: Relaxed 2 · Packed 2"], defaults: { pace: "relaxed" } },
    }));
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(GroupPanel, { tripId: "t1" })); });
    await flush(10);
    const t = textOf(r.root);
    expect(t).toContain("https://trailmate.test/poll/0123456789abcdef");
    expect(t).toContain("All 4: Relaxed pace");
    expect(t).toContain("Split: you decide");
    expect(r.root.find((n) => n.type === "a" && String(n.props.href).startsWith("https://wa.me/")).props.href).toContain(encodeURIComponent("/poll/0123456789abcdef"));
    expect(t).toContain("Use what the group agreed");
  });
});
