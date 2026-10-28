import { createElement, act } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateMatrix } from "@/lib/providers/estimate";
import { buildPlans, candidatesFor } from "@/lib/intake/propose";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let online = true;
vi.mock("@/lib/client/use-connectivity", () => ({ useOnline: () => online }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
// The start step links to the finished examples; a plain link here (next/link prefetches with browser-only APIs).
vi.mock("next/link", async () => { const { createElement } = await import("react"); return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => createElement("a", { href, ...rest }, children as never) }; });
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
  it("a guest signs up at 'Save': the plan is kept on this phone and the sign-up comes back here", async () => {
    const r = await render(false);
    await toUnderstood(r);
    await click(r, "Continue");
    await click(r, "Skip the rest and use the defaults");
    await click(r, "Sign up and save this trip");
    expect(push).toHaveBeenCalledWith("/signup?next=%2Fplan%3Fresume%3D1");
    expect(JSON.parse(store["tm:plan-draft:v1"]).draft.places.length).toBe(2);
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/trips")).toBe(false);
  });
  it("signed in: saves the trip with what was understood and the confirmed first day, adds the found places, opens Your plan", async () => {
    const r = await render(true);
    await toUnderstood(r);
    await click(r, "Continue");
    await click(r, "Skip the rest and use the defaults");
    await click(r, "Save and plan my trip");
    await flush(10);
    const trip = JSON.parse(String((fetchMock.mock.calls.find((c) => c[0] === "/api/trips")![1] as RequestInit).body));
    expect(trip).toMatchObject({ start_city: "Hyderabad", num_days: 4, end_mode: "start", intake: expect.objectContaining({ group: "friends", interests: ["beaches"] }) });
    expect(trip.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // the suggested first day, shown in the save step to confirm or change
    const bulk = JSON.parse(String((fetchMock.mock.calls.find((c) => c[0] === "/api/places/bulk")![1] as RequestInit).body));
    expect(bulk.trip_id).toBe("trip-77");
    expect(bulk.places.map((p: { name: string }) => p.name)).toEqual(["Warangal Fort", "Kondapalli"]);
    expect(push).toHaveBeenCalledWith("/trips/trip-77/result");
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

describe("the start screen and the describe step (redesign)", () => {
  it("start: each way in says what it is good for, and the examples can be tried with one tap", async () => {
    const r = await render();
    const t = textOf(r.root);
    for (const s of ["Fastest", "Type or speak", "Full control", "Or try an example", "See a finished plan first", "Try it"]) expect(t).toContain(s);
    expect(r.root.findAll((n) => n.type === "a").length).toBeGreaterThanOrEqual(2); // the finished plans are links
  });
  it("tapping an example opens the words step with that text already in the box", async () => {
    const r = await render();
    await click(r, "4 rojulu Hyderabad nundi");
    expect(r.root.find((n) => n.type === "textarea").props.value).toContain("4 rojulu Hyderabad nundi");
  });
  it("describe: a quick-add chip puts its words in the box once, then shows as added and cannot be added twice", async () => {
    const r = await render();
    await click(r, "Describe my trip");
    await click(r, "Beaches");
    await click(r, "Relaxed pace");
    expect(r.root.find((n) => n.type === "textarea").props.value).toBe("Beaches, relaxed pace");
    const beaches = buttons(r).find((b) => textOf(b).includes("Beaches"))!;
    expect(beaches.props.disabled).toBe(true);
    expect(beaches.props["aria-pressed"]).toBe(true);
  });
  it("paste mode does not show the chips (a caption is not a description)", async () => {
    const r = await render();
    await click(r, "I saw these places");
    expect(textOf(r.root)).not.toContain("Add details with a tap");
  });
  it("describe shows a character counter that follows the text", async () => {
    const r = await render();
    await click(r, "Describe my trip");
    expect(textOf(r.root)).toContain("0/4000");
    await act(async () => { r.root.find((n) => n.type === "textarea").props.onChange({ target: { value: "abcde" } }); });
    expect(textOf(r.root)).toContain("5/4000");
  });
});

describe("Plan it for me: a traveller who names only a town", () => {
  const HUBP = { lat: 13.6288, lng: 79.4192, name: "Tirupati" };
  const mk = (id: string, name: string, category: string, lat: number, lng: number) => ({ id, name, category, lat, lng, notable: true, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null });
  const ITEMS = [mk("way/1", "Hill Temple A", "temple", 13.683, 79.347), mk("way/2", "Old Fort B", "fort", 13.589, 79.318), mk("way/3", "Lake E", "lake", 13.6, 79.5), mk("way/4", "Museum F", "museum", 13.63, 79.42), mk("way/5", "Riverside Temple C", "temple", 13.749, 79.703), mk("way/6", "Viewpoint J", "viewpoint", 13.66, 79.38)];
  const ask = { hub: HUBP, days: 3, group: null, interests: [], pace: null, maxDriveHours: null } as never;
  const cands = candidatesFor(ITEMS as never, ask);
  const answer = { plans: buildPlans(cands, { ...estimateMatrix([HUBP, ...cands.map((c) => c.item)]), source: "osrm" }, ask), status: "ok", note: null, roadTimes: "road" };
  let proposeBody: Record<string, unknown> | null;
  const withTown = () => {
    const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<Response>;
    proposeBody = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/intake/read") return json({ understanding: { answers: {}, places: [], conflicts: [], unbacked: [], scripts: [] }, start: { place: HYD, alternatives: [], from: "text" }, places: [{ ...place("Tirupati", "Tirupati", 13.6288, 79.4192), place: { id: "gn:t", name: "Tirupati", lat: 13.6288, lng: 79.4192, kind: "city", area: "Andhra Pradesh", state: "Andhra Pradesh", source: "geonames", km: null, calledAs: null } }] });
      if (url === "/api/intake/propose") { proposeBody = JSON.parse(String(init?.body)); return json(answer); }
      return base(url, init);
    });
  };
  async function toTown(r: TestRenderer.ReactTestRenderer) {
    await click(r, "Describe my trip");
    await act(async () => { r.root.find((n) => n.type === "textarea").props.onChange({ target: { value: "family trip near Tirupati, I don't know what to see" } }); });
    await click(r, "Read it");
    await flush(1500);
  }
  it("shows three real plans round the town, with the reason for each stop", async () => {
    withTown();
    const r = await render(); await toTown(r);
    const t = textOf(r.root);
    expect(t).toContain("Not sure what to see around Tirupati?");
    for (const s of ["Relaxed", "Balanced", "Most places", "Day 1", "km from Tirupati"]) expect(t).toContain(s);
    expect(proposeBody).toMatchObject({ hub: { name: "Tirupati" } });
  });
  it("asks how many days when the traveller did not say, and re-plans when they tap one", async () => {
    withTown();
    const r = await render(); await toTown(r);
    expect(textOf(r.root)).toContain("How many days?");
    await click(r, /^5$/);
    await flush(1500);
    expect(proposeBody).toMatchObject({ days: 5 });
  });
  it("adds nothing by itself; 'Use the … plan' adds the places, and the panel stays to show they were added", async () => {
    withTown();
    const r = await render(); await toTown(r);
    expect(textOf(r.root)).not.toContain("Hill Temple A in your trip");
    await click(r, /Use the .* plan/);
    const t = textOf(r.root);
    expect(t).toContain("Added: change anything below");
    expect(t).toContain("Not sure what to see around Tirupati?");   // still there
    expect(t).toMatch(/Museum F|Hill Temple A/);                   // and now in the trip's list too
  });
  it("when the map servers fail it says why under Details, retries once by itself, and sends where the trip starts", async () => {
    withTown();
    let calls = 0;
    const inner = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/intake/propose") { calls++; proposeBody = JSON.parse(String(init?.body)); return json({ plans: [], sightDays: 3, travel: null, status: "unavailable", reason: "all map servers failed: overpass-api.de -> HTTP 429", note: "The free map servers are slow or busy right now, so we couldn't look around.", roadTimes: null }); }
      return inner(url, init);
    });
    const r = await render(); await toTown(r);
    const t = textOf(r.root);
    expect(t).toContain("slow or busy"); expect(t).toContain("Details (for support)"); expect(t).toContain("overpass-api.de -> HTTP 429");
    expect(t).toContain("We'll look once more in a few seconds");
    expect(proposeBody).toMatchObject({ start: { name: "Hyderabad" } });
    const before = calls;
    await flush(6500);                                                // the quiet retry fires (React applies it when this wait ends)
    await flush(1000);                                                // …and its request follows the normal 0.5 s pause
    expect(calls).toBe(before + 1);                                   // one quiet retry
    await flush(20000);
    expect(calls).toBe(before + 1);                                   // and no more: it never loops
    expect(textOf(r.root)).not.toContain("We'll look once more");
  });
  it("says it needs the internet when offline, and does not ask the server", async () => {
    withTown();
    const r = await render(); await toTown(r);
    online = false;
    await act(async () => { r.update(createElement(PlanFlow, { signedIn: false })); });
    expect(textOf(r.root)).toContain("Planning round a place needs the internet");
  });
});

describe("Your own test: family, Goa, 6 days, temples, going through Karnataka", () => {
  const stopOf = (id: string, name: string, alongKm: number, day: number) => ({ id, name, lat: 16 + alongKm / 1000, lng: 77 - alongKm / 1000, category: "temple", alongKm, offKm: 0.4, extraMin: 0, driveMin: alongKm, drivingDay: day, notable: true, hours: null, why: [`${alongKm} km from Hyderabad · about 4 h of driving`, "Right on your road", "Well known: it has a Wikipedia or Wikidata entry", "Matches your interest: Temples"] });
  const stops = [stopOf("osm:way/11", "Alampur Jogulamba Temple", 200, 1), stopOf("osm:way/12", "Virupaksha Temple", 380, 1), stopOf("osm:way/13", "Mahabaleshwar Temple Gokarna", 520, 2)];
  const stateOf = (name: string, lat: number, lng: number, status: string, reason: string) => ({ said: name, must: false, source: "said", evidence: name, status, reason, place: { id: `s:${name}`, name, lat, lng, kind: "state", area: "State of India", state: name, source: "geonames", km: null, calledAs: null }, alternatives: [] });
  let journeyBody: Record<string, unknown> | null;
  const withGoa = () => {
    const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<Response>;
    journeyBody = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/intake/read") return json({
        understanding: { answers: { days: { value: 6, source: "said", evidence: "6 days" }, group: { value: "family", source: "said", evidence: "family" }, interests: { value: ["temples"], source: "said", evidence: "temples" } }, places: [], conflicts: [], unbacked: [], scripts: [] },
        start: { place: HYD, alternatives: [], from: "text" },
        places: [stateOf("Goa", 15.3, 74.1, "check", "Goa is a whole state."), stateOf("State of Karnataka", 15.3, 75.7, "check", "State of Karnataka is a whole state.")],
      });
      if (url === "/api/intake/journey") { journeyBody = JSON.parse(String(init?.body)); return json({ status: "ok", road: { km: 650, minutes: 660, source: "road" }, drivingDays: 2, dayLimitHours: 7, stops, note: "Hyderabad to Goa is about 650 km, 12 h 39 min of driving. At 7 hours a day that is about 2 days of driving each way.", reason: null }); }
      if (url === "/api/intake/propose") return json({ plans: [], sightDays: 2, travel: { oneWayMin: 760, drivingDays: 4, estimated: false }, status: "none", reason: null, note: "Goa is about 12 h 40 min from Hyderabad each way. Getting there and back takes about 4 days of driving, so these plans are for 2 days of sights.", roadTimes: null });
      return base(url, init);
    });
  };
  async function typeIt(r: TestRenderer.ReactTestRenderer) {
    await click(r, "Describe my trip");
    await act(async () => { r.root.find((n) => n.type === "textarea").props.onChange({ target: { value: "we are a family going to Goa, 6 days, we love temples, we pass through Karnataka, show us temples on the way" } }); });
    await click(r, "Read it");
    await flush(1500);
  }
  it("shows temples along the road, grouped by driving day, with why each is there", async () => {
    withGoa();
    const r = await render(); await typeIt(r);
    const t = textOf(r.root);
    expect(t).toContain("Temples & religious sites on your way to Goa");
    for (const s of ["Driving day 1", "Driving day 2", "Alampur Jogulamba Temple", "Virupaksha Temple", "200 km from Hyderabad", "Right on your road", "Matches your interest: Temples", "Add all 3 stops"]) expect(t).toContain(s);
    expect(journeyBody).toMatchObject({ start: { name: "Hyderabad" }, dest: { name: "Goa" }, interests: ["temples"], round_trip: true });
  });
  it("tells them Karnataka is covered because the road goes through it", async () => {
    withGoa();
    const r = await render(); await typeIt(r);
    expect(textOf(r.root)).toContain("You mentioned Karnataka: the road to Goa goes through it, so you don't need to add it as a place.");
  });
  it("also plans round Goa, and says how many of the 6 days the driving takes", async () => {
    withGoa();
    const r = await render(); await typeIt(r);
    const t = textOf(r.root);
    expect(t).toContain("Not sure what to see around Goa?");
    expect(t).toContain("these plans are for 2 days of sights");
  });
  it("adds nothing by itself; 'Add all' adds the stops and the button then says they are in", async () => {
    withGoa();
    const r = await render(); await typeIt(r);
    expect(textOf(r.root)).not.toContain("All stops added");
    await click(r, "Add all 3 stops");
    const t = textOf(r.root);
    expect(t).toContain("All stops added");
    expect(t).toContain("In your trip");
  });
  it("adds one stop on its own", async () => {
    withGoa();
    const r = await render(); await typeIt(r);
    const one = buttons(r).find((b) => b.props["aria-label"] === "Add Virupaksha Temple to your trip")!;
    await act(async () => { one.props.onClick({ preventDefault: () => {} }); });
    await flush(10);
    expect(buttons(r).some((b) => b.props["aria-label"] === "Virupaksha Temple is in your trip")).toBe(true);
    expect(buttons(r).some((b) => b.props["aria-label"] === "Alampur Jogulamba Temple is in your trip")).toBe(false);
  });
});
