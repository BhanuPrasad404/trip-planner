import { describe, expect, it } from "vitest";
import { isGpsJump, MAX_PLAUSIBLE_MS } from "@/lib/map/navigation";
import { journeySummary } from "@/lib/map/journey";
import { SESSION_TEXT, deriveSessionState, type SessionFacts } from "@/lib/map/session-state";
import { parseReverse, roundForReverse } from "@/lib/geocode";
import { NavCamera } from "@/components/map/nav-camera";

describe("GPS jump filter", () => {
  const a = { lat: 17.97, lng: 79.59, at: 0 };
  it("accepts normal driving and flags impossible teleports", () => {
    expect(isGpsJump(null, a)).toBe(false);
    expect(isGpsJump(a, { lat: 17.9709, lng: 79.59, at: 5_000 })).toBe(false);            // 100 m in 5 s = 72 km/h: ordinary driving
    expect(isGpsJump(a, { lat: 17.98, lng: 79.59, at: 5_000 })).toBe(true);               // 1.1 km in 5 s = 800 km/h: not a car
  });
  it("uses distance AND speed so a small wobble never counts", () => {
    expect(isGpsJump(a, { lat: 17.9705, lng: 79.59, at: 500 })).toBe(false);              // 55 m
    expect(isGpsJump(a, { lat: 18.97, lng: 79.59, at: 1_000 })).toBe(true);               // 111 km in 1 s
    expect(isGpsJump(a, { lat: 18.97, lng: 79.59, at: 3_600_000 })).toBe(false);          // the same hop after an hour is just travel
    expect(MAX_PLAUSIBLE_MS).toBe(70);
  });
});

describe("journey totals use the same road legs", () => {
  it("adds what is left of this leg to the later legs and the stays in between", () => {
    const j = journeySummary({ nowMs: 1_000_000, currentLegRemainingM: 120_000, currentLegRemainingS: 5_400, laterLegs: [{ km: 250, minutes: 270 }, { km: 80, minutes: 90 }], visitMinutes: [60, 30], finalName: "Vizag" });
    expect(j).toMatchObject({ name: "Vizag", remainingKm: 450, remainingMin: 90 + 270 + 90 + 90, stops: 3 });
    expect(j.etaMs).toBe(1_000_000 + j.remainingMin * 60_000);
  });
  it("with no later legs it is just this leg", () => {
    expect(journeySummary({ nowMs: 0, currentLegRemainingM: 5_000, currentLegRemainingS: 600, laterLegs: [], visitMinutes: [45], finalName: "X" })).toMatchObject({ remainingKm: 5, remainingMin: 10, stops: 1 });
  });
});

describe("session state names what the drive is doing", () => {
  const base: SessionFacts = { driveActive: true, hasFix: true, gateOpen: false, positionUsable: true, navPhase: "navigating", rerouting: false, offRouteSuspected: false, following: true };
  const s = (o: Partial<SessionFacts>) => deriveSessionState({ ...base, ...o });
  it("walks through every state of the brief", () => {
    expect(s({ driveActive: false })).toBe("not-started");
    expect(s({ hasFix: false })).toBe("locating");
    expect(s({ gateOpen: true })).toBe("confirming");
    expect(s({ navPhase: "idle", positionUsable: false })).toBe("waiting-for-precise-position");
    expect(s({ navPhase: "idle" })).toBe("calculating");
    expect(s({ navPhase: "loading" })).toBe("calculating");
    expect(s({})).toBe("following");
    expect(s({ following: false })).toBe("exploring");
    expect(s({ offRouteSuspected: true })).toBe("off-route");
    expect(s({ rerouting: true, offRouteSuspected: true })).toBe("recalculating");
    expect(s({ navPhase: "arrived" })).toBe("arrived");
    expect(s({ navPhase: "error" })).toBe("error");
    expect(SESSION_TEXT.exploring).toMatch(/still tracking/);
  });
});

describe("naming the town around you", () => {
  it("prefers city/town/village and rounds the position to ~1 km before sending", () => {
    expect(parseReverse({ address: { city: "Warangal", state: "Telangana" } })).toBe("Warangal");
    expect(parseReverse({ address: { village: "Kazipet", county: "Hanumakonda" } })).toBe("Kazipet");
    expect(parseReverse({ address: { state: "Telangana" } })).toBe("Telangana");
    expect(parseReverse({})).toBeNull();
    expect(parseReverse(null)).toBeNull();
    expect(roundForReverse(17.968912)).toBe(17.97);
    expect(roundForReverse(79.594138)).toBe(79.59);
  });
});

// A map double that records what the camera is told to do.
function fakeMap() {
  const calls: string[] = [];
  let center = { lng: 80, lat: 17 }, zoom = 9, bearing = 0, pitch = 0;
  return {
    calls,
    map: {
      jumpTo: (o: { center: [number, number]; zoom: number; bearing: number; pitch: number }) => { calls.push("jump"); center = { lng: o.center[0], lat: o.center[1] }; zoom = o.zoom; bearing = o.bearing; pitch = o.pitch; },
      getCenter: () => center, getZoom: () => zoom, getBearing: () => bearing, getPitch: () => pitch,
    },
    state: () => ({ center, zoom, bearing, pitch }),
  };
}

describe("camera: follows, lets go when the traveller explores, and glides back", () => {
  it("never touches the camera while exploring, and re-centres by gliding from where the user left it", () => {
    const frames: ((t: number) => void)[] = [];
    (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: (t: number) => void) => (frames.push(cb), frames.length);
    (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = () => {};
    const f = fakeMap();
    const puck: number[] = [];
    const cam = new NavCamera(f.map as never, (p) => puck.push(p.lng));
    cam.setTarget({ lng: 80, lat: 17, bearing: 90, zoom: 17, pitch: 50 });
    cam.start();
    let now = performance.now();
    const run = (n: number, dt = 16) => { for (let i = 0; i < n; i++) { now += dt; const cb = frames.shift(); cb?.(now); } };
    run(30);
    expect(f.calls.length).toBeGreaterThan(0);

    // the traveller zooms out and pans away: follow is switched off
    cam.setFollowing(false);
    const jumpsBefore = f.calls.length;
    cam.setTarget({ lng: 80.01, lat: 17.01, bearing: 95, zoom: 16, pitch: 50 }); // GPS keeps coming in…
    run(60);
    expect(f.calls.length).toBe(jumpsBefore);          // …but the camera is NOT touched (no snapping back)
    expect(puck.at(-1)).toBeGreaterThan(80.005);       // while the puck keeps gliding along

    // the traveller had zoomed the map out to 8; re-centre glides from there, it does not teleport
    f.map.jumpTo({ center: [80.5, 17.5], zoom: 8, bearing: 0, pitch: 0 });
    f.calls.length = 0;
    cam.setFollowing(true);
    run(1);
    expect(f.state().zoom).toBeLessThan(9);            // first frame is still near the user's own view
    run(120);
    expect(f.state().zoom).toBeGreaterThan(15.5);      // …and ends at the navigation view
    expect(f.state().pitch).toBeGreaterThan(45);
    cam.stop();
  });
});

describe("Re-centre is a command that always works", () => {
  it("glides from the traveller's own view to the CURRENT position even when the camera never had a target (e.g. right after switching routes) and the traveller has not moved", () => {
    const frames: ((t: number) => void)[] = [];
    (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: (t: number) => void) => (frames.push(cb), frames.length);
    (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = () => {};
    const f = fakeMap();
    f.map.jumpTo({ center: [78.5, 18.5], zoom: 6, bearing: 40, pitch: 0 });          // the traveller zoomed out and looked elsewhere
    f.calls.length = 0;
    const cam = new NavCamera(f.map as never, () => {});
    cam.setFollowing(false);                                                           // exploring
    cam.start();                                                                       // …and no GPS reading has produced a target yet
    let now = performance.now();
    const run = (n: number) => { for (let i = 0; i < n; i++) { now += 16; frames.shift()?.(now); } };
    run(20);
    expect(f.calls).toHaveLength(0);                                                   // exploring: untouched

    cam.recenter({ lng: 79.59, lat: 17.97, bearing: 90, zoom: 17, pitch: 50 });        // the Re-centre command (current GPS position)
    run(1);
    expect(f.calls.length).toBeGreaterThan(0);                                         // it acts immediately…
    expect(f.state().zoom).toBeLessThan(8);                                            // …starting from the view they had (no teleport)
    run(200);
    expect(f.state().center.lng).toBeCloseTo(79.59, 1);                                // ends on the current position
    expect(f.state().center.lat).toBeCloseTo(17.97, 1);
    expect(f.state().zoom).toBeGreaterThan(16.5);
    expect(f.state().pitch).toBeGreaterThan(45);
    expect(cam.following).toBe(true);
    // pressing it AGAIN while already there still works (it used to do nothing when the position had not changed)
    f.map.jumpTo({ center: [80, 19], zoom: 7, bearing: 0, pitch: 0 });
    cam.recenter({ lng: 79.59, lat: 17.97, bearing: 90, zoom: 17, pitch: 50 });
    run(200);
    expect(f.state().center.lng).toBeCloseTo(79.59, 1);
    cam.stop();
  });
});
