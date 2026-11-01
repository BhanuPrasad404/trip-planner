// The arrival alert, end to end without a phone: fake GPS readings, a fake clock and fake audio/vibration/voice.
//   approaching at 100 m → "Arriving in … m" (map strip + Drive panel), once, with a chime, a buzz and the voice;
//   arrived at 50 m after a short stay → "You have arrived at X" with "Mark as done", once;
//   sound is unlocked by the Start-drive tap; the traveller's mute and "alerts off" always win; in the background only the phone's
//   notification is used.
import { createElement, act, type MutableRefObject } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArrivalCard } from "@/components/ArrivalCard";
import { DrivePanel } from "@/components/DrivePanel";
import { ApproachStrip, NavigationBanner, NavigationPanel, type NavUi } from "@/components/map/NavigationOverlay";
import { useArrival, withoutStaleApproach } from "@/lib/client/use-arrival";
import { CHIME, VIBRATION, driveAudioState, playChime, resetDriveAudio, unlockDriveAudio, vibrate } from "@/lib/client/drive-audio";
import { SPEAK_AFTER_CHIME_MS, approachText, arrivedText, deliverCue, type CueChannels } from "@/lib/client/arrival-cue";
import { DEFAULT_ALERT_PREFS } from "@/lib/alerts/prefs";
import { planDelivery } from "@/lib/alerts/delivery";
import type { Me } from "@/lib/client/use-drive";
import type { Navigation } from "@/lib/client/use-navigation";
import type { ArrivalStop } from "@/lib/trip/arrival";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const T0 = 1_800_000_000_000;
const M = 111_195; // metres per degree of latitude
const stop = (o: Partial<ArrivalStop> = {}): ArrivalStop => ({ id: "s1", name: "Thousand Pillar Temple", lat: 17.9989, lng: 79.5747, category: "temple", status: "planned", order: 1, kind: "stop", ...o });

// ── A fake Web Audio context: records what was played, and starts "suspended" like a real browser before a tap. ──
type Played = { hz: number; at: number };
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static startState: AudioContextState = "suspended";
  static resumeWorks = true;
  state: AudioContextState = FakeAudioContext.startState;
  currentTime = 10;
  destination = {};
  played: Played[] = [];
  silentBuffers = 0;
  constructor() { FakeAudioContext.instances.push(this); }
  resume() { if (FakeAudioContext.resumeWorks) this.state = "running"; return Promise.resolve(); }
  createBuffer() { return {}; }
  createBufferSource() { return { buffer: null, connect: () => {}, start: () => { this.silentBuffers++; } }; }
  createGain() { return { gain: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} }; }
  createOscillator() {
    const o = { type: "", frequency: { value: 0 }, connect: () => {}, start: (at: number) => { this.played.push({ hz: o.frequency.value, at }); }, stop: () => {} };
    return o;
  }
}

describe("drive sounds: unlocked by the Start-drive tap, then an original chime", () => {
  let spoken: string[]; let buzzes: number[][];
  beforeEach(() => {
    resetDriveAudio(); FakeAudioContext.instances = []; FakeAudioContext.startState = "suspended"; FakeAudioContext.resumeWorks = true;
    spoken = []; buzzes = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("navigator", { vibrate: (p: number[]) => { buzzes.push(p); return true; } });
    vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; volume = 1; constructor(t: string) { this.text = t; } });
    vi.stubGlobal("window", { speechSynthesis: { speak: (u: { text: string; volume: number }) => { spoken.push(`${u.volume}:${u.text}`); }, cancel: () => {} } });
  });
  afterEach(() => { vi.unstubAllGlobals(); resetDriveAudio(); });

  it("before any tap, nothing can play (autoplay rules): the chime reports that it did not sound", () => {
    expect(playChime("arrived")).toBe(false);
    expect(driveAudioState()).toBe("blocked");
  });
  it("the tap creates ONE context, plays a silent sound, resumes it and primes the voice silently", () => {
    expect(unlockDriveAudio()).toBe("running");
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].silentBuffers).toBe(1);
    expect(spoken).toEqual(["0:"]); // an empty, silent utterance
    unlockDriveAudio(); // a second Start tap reuses the same context
    expect(FakeAudioContext.instances).toHaveLength(1);
  });
  it("after the tap the arrival chime plays its three rising notes (with a quiet octave overtone each)", () => {
    unlockDriveAudio();
    expect(playChime("arrived")).toBe(true);
    const played = FakeAudioContext.instances[0].played;
    expect(played).toHaveLength(CHIME.arrived.length * 2);
    const fundamentals = played.filter((_, i) => i % 2 === 0).map((p) => p.hz);
    expect(fundamentals).toEqual(CHIME.arrived.map((n) => n.hz));
    expect([...fundamentals].sort((a, b) => a - b)).toEqual(fundamentals); // rising
  });
  it("approaching and arrived sound different", () => {
    expect(CHIME.approach.map((n) => n.hz)).not.toEqual(CHIME.arrived.map((n) => n.hz));
    expect(CHIME.approach.length).toBeLessThan(CHIME.arrived.length);
  });
  it("a browser that refuses to unlock is reported as blocked (so the screen can say so), and nothing is played", () => {
    FakeAudioContext.resumeWorks = false;
    expect(unlockDriveAudio()).toBe("blocked");
    expect(playChime("arrived")).toBe(false);
  });
  it("no Web Audio at all: 'unsupported', never a crash", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(unlockDriveAudio()).toBe("unsupported");
    expect(playChime("approach")).toBe(false);
  });
  it("buzz patterns are short (never a long buzz while driving), and arrival is distinct from approaching", () => {
    vibrate("approach"); vibrate("arrived");
    expect(buzzes).toEqual([VIBRATION.approach, VIBRATION.arrived]);
    for (const p of buzzes) expect(p.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(500);
    vi.stubGlobal("navigator", {});
    expect(vibrate("arrived")).toBe(false);
  });
});

describe("how a cue reaches the traveller", () => {
  const channels = () => {
    const log: string[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    const sound = { on: true };
    const ch: CueChannels = {
      stillOn: () => sound.on,
      chime: (k) => { log.push(`chime:${k}`); return true; },
      vibrate: (k) => { log.push(`buzz:${k}`); return true; },
      speak: (t) => { log.push(`say:${t}`); },
      notify: (a) => { log.push(`notify:${a.title}`); return true; },
      later: (fn, ms) => { timers.push({ fn, ms }); },
    };
    return { ch, log, timers, sound, flush: () => { for (const t of timers) t.fn(); } };
  };
  const text = arrivedText("Thousand Pillar Temple", false);

  it("on screen: chime, buzz, then the voice says the place by name after the chime", () => {
    const c = channels();
    const out = deliverCue("arrived", "s1", text, { hidden: false, soundOn: true, prefs: DEFAULT_ALERT_PREFS }, c.ch);
    expect(c.log).toEqual(["chime:arrived", "buzz:arrived"]);
    expect(c.timers[0].ms).toBe(SPEAK_AFTER_CHIME_MS);
    c.flush(); expect(c.log.at(-1)).toBe("say:You have arrived at Thousand Pillar Temple");
    expect(out).toEqual({ via: "screen", chimed: true, buzzed: true, spoke: true });
  });
  it("the arrival chime plays by default even though the general alert tone is off by default", () => {
    expect(DEFAULT_ALERT_PREFS.sound).toBe(false);
    const c = channels(); deliverCue("arrived", "s1", text, { hidden: false, soundOn: true, prefs: DEFAULT_ALERT_PREFS }, c.ch);
    expect(c.log).toContain("chime:arrived");
  });
  it("muted drive sounds: no chime and no voice, only the buzz", () => {
    const c = channels(); deliverCue("arrived", "s1", text, { hidden: false, soundOn: false, prefs: DEFAULT_ALERT_PREFS }, c.ch); c.flush();
    expect(c.log).toEqual(["buzz:arrived"]);
  });
  it("muting during the chime silences the voice that was about to speak", () => {
    const c = channels(); deliverCue("arrived", "s1", text, { hidden: false, soundOn: true, prefs: DEFAULT_ALERT_PREFS }, c.ch);
    c.sound.on = false; c.flush();
    expect(c.log.some((l) => l.startsWith("say:"))).toBe(false);
  });
  it("in the background during quiet hours the phone notification still goes out (a drive the traveller started)", () => {
    const sent: Parameters<NonNullable<CueChannels["notify"]>>[0][] = [];
    const c = channels(); c.ch.notify = (a) => { sent.push(a); return true; };
    deliverCue("arrived", "s1", text, { hidden: true, soundOn: true, prefs: DEFAULT_ALERT_PREFS }, c.ch);
    expect(sent[0].duringDrive).toBe(true);
    const at0530IST = Date.UTC(2026, 9, 18, 0, 0); // 05:30 in India, inside the default 22:00–07:00 quiet hours
    const ctx = { nowMs: at0530IST, utcOffsetMin: 330, appVisible: false, permission: "granted" as const, canVibrate: true, canBeep: true };
    const prefs = { ...DEFAULT_ALERT_PREFS, phone: true };
    expect(planDelivery(sent[0], prefs, ctx).phone).toBe(true);
    expect(planDelivery({ ...sent[0], duringDrive: undefined }, prefs, ctx).phone).toBe(false); // other alerts still respect quiet hours
    expect(planDelivery(sent[0], { ...prefs, phone: false }, ctx).phone).toBe(false); // the traveller's own switch still wins
  });
  it("buzz switched off: no buzz", () => {
    const c = channels(); deliverCue("approach", "s1", text, { hidden: false, soundOn: true, prefs: { ...DEFAULT_ALERT_PREFS, haptics: false } }, c.ch);
    expect(c.log).toEqual(["chime:approach"]);
  });
  it("alerts switched off entirely: no chime and no buzz (the on-screen card still shows)", () => {
    const c = channels(); deliverCue("arrived", "s1", text, { hidden: false, soundOn: true, prefs: { ...DEFAULT_ALERT_PREFS, enabled: false } }, c.ch); c.flush();
    expect(c.log.filter((l) => l.startsWith("chime") || l.startsWith("buzz"))).toEqual([]);
  });
  it("quiet hours do not silence a drive the traveller started (it has no clock input at all)", () => {
    const c = channels(); deliverCue("arrived", "s1", text, { hidden: false, soundOn: true, prefs: { ...DEFAULT_ALERT_PREFS, quiet: { startMin: 0, endMin: 1439 } } }, c.ch);
    expect(c.log).toContain("chime:arrived");
  });
  it("chime unavailable (not unlocked): the voice is not delayed", () => {
    const c = channels(); c.ch.chime = () => false;
    deliverCue("arrived", "s1", text, { hidden: false, soundOn: true, prefs: DEFAULT_ALERT_PREFS }, c.ch);
    expect(c.timers[0].ms).toBe(0);
  });
  it("in the background: only the phone notification, with the place in the title", () => {
    const c = channels(); const out = deliverCue("arrived", "s1", text, { hidden: true, soundOn: true, prefs: DEFAULT_ALERT_PREFS }, c.ch); c.flush();
    expect(c.log).toEqual(["notify:You have arrived at Thousand Pillar Temple"]); expect(out.via).toBe("notification");
  });
  it("wording: approaching rounds to 10 m and names the place; a large place is an area", () => {
    expect(approachText("Warangal Fort", 96)).toMatchObject({ title: "Arriving at Warangal Fort in 100 m", spoken: "Arriving at Warangal Fort in 100 metres" });
    expect(approachText("X", 3).title).toBe("Arriving at X in 10 m");
    expect(arrivedText("Pakhal Lake", true).title).toBe("You've reached the Pakhal Lake area");
  });
});

describe("useArrival with a fake GPS and a fake clock", () => {
  let store: Record<string, string>; let now: number;
  beforeEach(() => {
    store = {}; now = T0; vi.useFakeTimers(); vi.setSystemTime(T0);
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  let api: ReturnType<typeof useArrival>; let r: TestRenderer.ReactTestRenderer;
  let marks: string[]; let arrivals: string[]; let approaches: [string, number][]; let prompts: [string, boolean][]; let finished: number;
  const holder: { ref: MutableRefObject<((m: Me) => void) | null> } = { ref: { current: null } };
  type Cfg = { stops?: ArrivalStop[]; targetId?: string | null; enabled?: boolean; session?: number };
  const Inner = (c: Cfg) => {
    api = useArrival({
      tripId: "t1", userId: "u1", stops: c.stops ?? [stop()], targetId: c.targetId === undefined ? "s1" : c.targetId, enabled: c.enabled ?? true, session: c.session ?? 1, arrivalRef: holder.ref,
      mark: async (id) => { marks.push(id); return "saved"; },
      arrive: async (id) => { arrivals.push(id); return "saved"; },
      onApproach: (s, i) => { approaches.push([s.id, i.distanceM]); }, onPrompt: (s, i) => { prompts.push([s.id, i.area]); }, onFinish: () => { finished++; },
    });
    return null;
  };
  const mount = async (c: Cfg = {}) => { marks = []; arrivals = []; approaches = []; prompts = []; finished = 0; holder.ref.current = null; await act(async () => { r = TestRenderer.create(createElement(Inner, c)); }); };
  const rerender = async (c: Cfg) => { await act(async () => { r.update(createElement(Inner, c)); }); };
  afterEach(() => { act(() => r?.unmount()); });
  /** A reading `northM` metres north of the first stop, `after` seconds after the previous one. */
  const at = async (northM: number, after: number, o: Partial<Me> = {}) => {
    now += after * 1000; vi.setSystemTime(now);
    const s = stop();
    await act(async () => { holder.ref.current?.({ lat: s.lat + northM / M, lng: s.lng, heading: null, speedKmh: 20, accuracyM: 8, at: now, fixAt: now, ...o }); });
  };

  it("drives in: nothing at 250 m, 'Arriving in 100 m' at the second reading inside 100 m, then the live distance", async () => {
    await mount();
    await at(250, 0); await at(98, 4); expect(api.approach).toBeNull();
    await at(96, 3); expect(api.approach).toMatchObject({ name: "Thousand Pillar Temple", distanceM: 100, area: false });
    await at(72, 3); expect(api.approach?.distanceM).toBe(70);
    expect(approaches).toEqual([["s1", 96]]); // announced once
  });
  it("then arrives: 'approaching' gives way to the arrival card after a real 8-second stay within 50 m", async () => {
    await mount();
    await at(98, 0); await at(96, 3); await at(40, 3, { speedKmh: 4 });
    expect(api.prompt).toBeNull(); expect(api.approach).not.toBeNull();
    await at(35, 8, { speedKmh: 2 });
    expect(api.prompt).toMatchObject({ name: "Thousand Pillar Temple", area: false, destination: false });
    expect(api.approach).toBeNull();
    expect(prompts).toEqual([["s1", false]]);
    await at(30, 5, { speedKmh: 0 }); await at(30, 5, { speedKmh: 0 });
    expect(prompts).toHaveLength(1); // once
  });
  it("weak GPS (±60 m) never announces or arrives; it only says 'you may be near'", async () => {
    await mount();
    for (const [n, t] of [[95, 0], [80, 3], [30, 3], [30, 10]] as const) await at(n, t, { accuracyM: 60, speedKmh: 2 }); // slowly: a question is only shown to someone who has slowed down
    expect(approaches).toEqual([]); expect(api.prompt).toBeNull(); expect(api.unsure).toMatchObject({ name: "Thousand Pillar Temple" });
  });
  it("GPS wobble on the edge does not flicker the strip on and off", async () => {
    await mount();
    await at(98, 0); await at(96, 3);
    const shown: boolean[] = [];
    for (const n of [104, 97, 110, 99, 140]) { await at(n, 2); shown.push(api.approach !== null); }
    expect(shown).toEqual([true, true, true, true, true]);
    await at(160, 2); expect(api.approach).toBeNull();
  });
  it("\"I've arrived\" records the arrival (once), marks nothing visited, and clears the prompt", async () => {
    await mount(); await at(30, 0, { speedKmh: 2 }); await at(30, 9, { speedKmh: 2 });
    await act(async () => { api.confirm(); await Promise.resolve(); });
    expect(arrivals).toEqual(["s1"]); expect(marks).toEqual([]); expect(api.prompt).toBeNull(); expect(api.approach).toBeNull(); expect(api.done?.name).toBe("Thousand Pillar Temple");
  });
  it("the trip's destination: 'Finish drive' ends the drive and marks nothing", async () => {
    const dest = stop({ id: "__destination__", name: "Hanamkonda", kind: "destination", category: null });
    await mount({ stops: [dest], targetId: dest.id });
    await at(30, 0, { speedKmh: 2 }); await at(30, 9, { speedKmh: 2 });
    expect(api.prompt).toMatchObject({ destination: true });
    await act(async () => { api.confirm(); await Promise.resolve(); });
    expect(finished).toBe(1); expect(marks).toEqual([]);
  });
  it("Finish at the destination is not remembered: the next drive of the same trip can finish there too", async () => {
    const dest = stop({ id: "__destination__", name: "Hanamkonda", kind: "destination", category: null });
    await mount({ stops: [dest], targetId: dest.id, session: 1 });
    await at(30, 0, { speedKmh: 2 }); await at(30, 9, { speedKmh: 2 });
    await act(async () => { api.confirm(); await Promise.resolve(); });
    expect(finished).toBe(1); expect(store["tm:arrival:u1:t1"] ?? "{}").not.toContain("__destination__");
    await rerender({ stops: [dest], targetId: dest.id, session: 2 });
    await at(30, 10, { speedKmh: 2 }); await at(30, 9, { speedKmh: 2 });
    expect(api.prompt).toMatchObject({ destination: true });
  });
  it("a large place reports 'area' so the card and the voice say 'You've reached the … area'", async () => {
    await mount({ stops: [stop({ category: "fort" })] });
    await at(250, 0, { speedKmh: 3 }); await at(240, 9, { speedKmh: 3 });
    expect(prompts).toEqual([["s1", true]]); expect(api.prompt?.area).toBe(true);
  });
  it("a new drive (new session) may announce the same stop again; the old one's strip is not shown", async () => {
    await mount({ session: 1 }); await at(98, 0); await at(96, 3); expect(api.approach).not.toBeNull();
    await rerender({ session: 2 }); expect(api.approach).toBeNull();
    await at(400, 3); await at(98, 3); await at(95, 3);
    expect(approaches.map((a) => a[0])).toEqual(["s1", "s1"]);
  });
  it("an unanswered card for a stop passed in traffic comes down when you drive away, and the real next stop's strip shows", async () => {
    const passed = stop({ id: "b", name: "Roadside Temple", order: 2 });
    const target = stop({ id: "s1", order: 1, lat: stop().lat + 1000 / M });
    await mount({ stops: [target, passed], targetId: "s1" });
    await at(20, 0, { speedKmh: 6 }); await at(25, 9, { speedKmh: 6 });
    expect(api.prompt?.name).toBe("Roadside Temple");
    await at(300, 10); // clearly past it
    expect(api.prompt).toBeNull();
    await at(1000 - 95, 20); await at(1000 - 90, 3);
    expect(api.approach).toMatchObject({ name: "Thousand Pillar Temple" });
  });
  it("once navigation says 'You have arrived', no old 'Arriving in … m' is shown next to it", () => {
    const a = { approach: { session: 1, stopId: "s1", name: "T", distanceM: 70, area: false }, prompt: null };
    expect(withoutStaleApproach(a, "arrived").approach).toBeNull();
    expect(withoutStaleApproach(a, "navigating")).toBe(a);
  });
  it("a different next stop: the strip is only ever about the stop you are heading for", async () => {
    await mount({ targetId: "other" }); await at(98, 0); await at(96, 3);
    expect(api.approach).toBeNull(); expect(approaches).toEqual([]);
  });
});

// ── What the traveller sees ──
const noop = vi.fn();
const nav = (over: Partial<Navigation> = {}): Navigation => ({
  phase: "navigating", routes: [], choices: [], selectedId: null, banner: null, puck: null, rerouting: false, offRouteSuspected: false, uncertain: false, notice: null, error: null, notes: [], alternatives: [], altChoices: [], altLoading: false, altFrom: null,
  progress: { alongM: 0, offsetM: 0, snapped: { lat: 0, lng: 0 }, routeBearing: 0, remainingM: 90, remainingS: 20, etaMs: T0, step: {}, nextStep: null, distanceToManeuverM: 90, arrived: false },
  target: { id: "s1", name: "Thousand Pillar Temple", lat: 17.9, lng: 79.6, kind: "stop" }, voice: true, armed: true,
  arm: noop, routeOptions: noop, closeOptions: noop, choose: noop, begin: noop, stop: noop, retry: noop, toggleVoice: noop, dismissNotice: noop,
  ...over,
} as unknown as Navigation);
const ui = (n: Navigation, over: Partial<NavUi> = {}): NavUi => ({ nav: n, session: "following", follow: true, headingUp: true, journey: null, startedFrom: null, manualPlace: null, speedKmh: null, nowMs: T0, signal: null, onRecenter: noop, onOverview: noop, onToggleHeading: noop, ...over });

describe("on the map and in the Drive panel", () => {
  it("the map shows 'Arriving in 100 m' and the place, and the live region announces the place once (not every 10 m)", () => {
    const h = renderToStaticMarkup(<NavigationBanner ui={ui(nav(), { approach: { name: "Thousand Pillar Temple", distanceM: 100, area: false } })} />);
    expect(h).toContain("Arriving in 100 m"); expect(h).toContain("Thousand Pillar Temple");
    expect(h).toMatch(/role="status" aria-live="polite" class="sr-only">Arriving at Thousand Pillar Temple</);
  });
  it("the turn banner stays above it (the last turn into a stop can be inside these 100 m)", () => {
    const banner = { arrow: "right", distanceText: "50 m", instruction: "Turn right", spoken: "", announceKey: null };
    const h = renderToStaticMarkup(<NavigationBanner ui={ui(nav({ banner } as never), { approach: { name: "T", distanceM: 80, area: false } })} />);
    expect(h.indexOf("Turn right")).toBeLessThan(h.indexOf("Arriving in 80 m"));
  });
  it("no strip when nothing is close", () => { expect(renderToStaticMarkup(<NavigationBanner ui={ui(nav())} />)).not.toContain("Arriving in"); });
  it("arrived: the panel does not repeat what the arrival card says", () => {
    expect(renderToStaticMarkup(<NavigationPanel ui={ui(nav({ phase: "arrived" }), { arrivalCardOpen: true, onArrivedDone: noop })} />)).toBe("");
    const h = renderToStaticMarkup(<NavigationPanel ui={ui(nav({ phase: "arrived" }), { arrivalCardOpen: false, onArrivedDone: noop })} />);
    expect(h).toContain("You have arrived at Thousand Pillar Temple"); expect(h).toContain("Mark as done");
  });
  it("the sound switch is one toggle with a fixed name and its state in aria-pressed (what it controls: voice AND chime)", () => {
    expect(renderToStaticMarkup(<NavigationPanel ui={ui(nav({ voice: true }))} floating={false} />)).toMatch(/aria-pressed="true" aria-label="Drive sounds \(voice and arrival chime\)"/);
    expect(renderToStaticMarkup(<NavigationPanel ui={ui(nav({ voice: false }))} floating={false} />)).toMatch(/aria-pressed="false" aria-label="Drive sounds \(voice and arrival chime\)"/);
  });
  it("the live region is always there (empty when nothing is close), so its text is announced when it appears", () => {
    expect(renderToStaticMarkup(<NavigationBanner ui={ui(nav())} />)).toContain('role="status" aria-live="polite" class="sr-only"></p>');
    expect(renderToStaticMarkup(<ApproachStrip approach={{ name: "T", distanceM: 90, area: false }} />)).not.toContain("aria-live"); // no second, duplicate region
  });
  it("a large place reads as an area", () => { expect(renderToStaticMarkup(<ApproachStrip approach={{ name: "Pakhal Lake", distanceM: 450, area: true }} />)).toContain("Pakhal Lake area"); });

  const drive = { active: true, share: true, me: null, manualPlace: null, setManual: noop, quality: null, locating: false, session: 1, error: null, shareFailed: false, route: null, drivingMin: null, members: {}, start: noop, resume: noop, stop: noop, setShare: noop };
  const panel = (extra: Partial<React.ComponentProps<typeof DrivePanel>>) => renderToStaticMarkup(<DrivePanel drive={drive} members={[]} userId="me" stops={[]} stayMinutes={() => 0} comparePlan={false} dayLabel="Day 1" nowMs={T0} {...extra} />);
  it("the Drive panel shows 'Arriving in … m', then 'You have arrived at …'", () => {
    expect(panel({ arrival: { approach: { name: "Thousand Pillar Temple", distanceM: 60, area: false }, arrivedName: null } })).toContain("Arriving in 60 m");
    expect(panel({ arrival: { approach: null, arrivedName: "Thousand Pillar Temple" } })).toContain("You have arrived at Thousand Pillar Temple");
  });
  it("the Drive panel has a visible sound switch and is honest about what a browser cannot do", () => {
    const h = panel({ sound: { on: true, toggle: noop, blocked: false } });
    expect(h).toContain("Drive sounds on"); expect(h).toContain('aria-pressed="true"');
    expect(h).toContain("arrival alerts can&#x27;t sound while the screen is locked"); expect(h).toContain("silent switch");
    expect(h).not.toContain("blocked sound");
    expect(panel({ sound: { on: true, toggle: noop, blocked: true, canBuzz: true } })).toContain("will still show on screen and buzz but not chime");
    expect(panel({ sound: { on: true, toggle: noop, blocked: true, canBuzz: false } })).toContain("will still show on screen but not chime"); // iPhone: no buzz promised
    expect(panel({ sound: { on: false, toggle: noop, blocked: false } })).toContain("Drive sounds off");
  });
});

describe("the arrival card", () => {
  const base = { prompt: null, unsure: null, done: null, progress: null, next: null, busy: false, onConfirm: noop, onComplete: noop, onPassing: noop, onExplore: noop, onDismiss: noop, onConfirmUnsure: noop, onDismissUnsure: noop, onUndo: noop, onSkipEarlier: noop, onKeepEarlier: noop, onClose: noop, onNavigate: null };
  const html = (o: Partial<Parameters<typeof ArrivalCard>[0]>) => renderToStaticMarkup(createElement(ArrivalCard, { ...base, ...o }));
  it("says 'You have arrived at X' with a clear, large \"I've arrived\"", () => {
    const h = html({ prompt: { name: "Thousand Pillar Temple", distanceM: 22, accuracyM: 6 } });
    expect(h).toContain("You have arrived at Thousand Pillar Temple"); expect(h).toContain("I&#x27;ve arrived"); expect(h).toContain("min-h-12"); expect(h).toContain("Not yet");
  });
  it("a large place: 'You've reached the … area'; the destination: 'Finish drive'", () => {
    expect(html({ prompt: { name: "Pakhal Lake", distanceM: 300, accuracyM: 8, area: true } })).toContain("You&#x27;ve reached the Pakhal Lake area");
    const d = html({ prompt: { name: "Hanamkonda", distanceM: 20, accuracyM: 5, destination: true } });
    expect(d).toContain("Finish drive"); expect(d).not.toContain("Mark as done");
  });
});
