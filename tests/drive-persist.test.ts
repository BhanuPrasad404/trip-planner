// What an active drive keeps on the phone: per person and per trip, with expiry, cleaned up on finish, sign-out and trip deletion.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_UI, MAX_AGE_MS, MAX_SNAPSHOT_CHARS, NO_GPS_EXPIRY_MS, activeDriveKey, clearDrive, clearUserDrives, driveKey, droppedReason, expiryReason,
  needsSwitch, parseSnapshot, readActiveDrive, serializeSnapshot, writeDrive, type DriveSnapshot,
} from "@/lib/drive/persist";
import { acquireDriveLock, driveLockName } from "@/lib/drive/lock";
import { forgetTripLocally } from "@/lib/trip/deletion";

const T0 = 1_800_000_000_000;
const memStore = () => {
  const m = new Map<string, string>();
  return {
    m,
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
};
const route = { id: "r1", distanceM: 12_000, durationS: 900, line: [[78.4, 17.4], [78.5, 17.5]] as [number, number][], steps: [{ index: 0, instruction: "Head north", name: "", ref: null, maneuver: { type: "depart" }, distanceM: 12_000, durationS: 900, startAlongM: 0, endAlongM: 12_000 }], via: "NH65", source: "osrm" as const };
const snap = (o: Partial<DriveSnapshot> = {}): DriveSnapshot => ({
  v: 1, userId: "u1", tripId: "t1", tripName: "Warangal weekend", savedAt: T0, startedAt: T0, lastFixAt: T0, session: 3, confirmedSession: 3, share: true,
  nav: { armed: true, targetId: "s1", route: route as never }, driveRoute: { legs: [{ km: 12, minutes: 15 }], line: [[78.4, 17.4], [78.5, 17.5]], source: "osrm", stopIds: ["s1"], at: T0 },
  cued: ["approach:s1"], next: { id: "s1", name: "Bhongir Fort" }, ui: { ...DEFAULT_UI, follow: false, focusDay: 2, camera: { center: [78.45, 17.45], zoom: 13, bearing: 30, pitch: 40 } }, ...o,
});

describe("scoped per person and per trip", () => {
  it("keys name the person and the trip", () => {
    expect(driveKey("u1", "t1")).toBe("tm:drive:u1:t1"); expect(activeDriveKey("u1")).toBe("tm:drive-active:u1");
  });
  it("round trip: what was saved is what comes back (route, camera, alerts already given, the start check)", () => {
    const s = snap();
    expect(parseSnapshot(serializeSnapshot(s), { userId: "u1", tripId: "t1" }, T0 + 60_000)).toEqual(s);
  });
  it("another person on the same phone never gets it", () => {
    expect(parseSnapshot(serializeSnapshot(snap()), { userId: "u2" }, T0)).toBeNull();
    const st = memStore(); writeDrive(st, snap());
    expect(readActiveDrive(st, "u2", T0)).toBeNull(); expect(readActiveDrive(st, "u1", T0)?.tripId).toBe("t1");
  });
  it("another trip's saved drive is not this trip's", () => { expect(parseSnapshot(serializeSnapshot(snap()), { userId: "u1", tripId: "t2" }, T0)).toBeNull(); });
});

describe("expires", () => {
  it("after 3 hours without a GPS reading", () => {
    expect(expiryReason(snap(), T0 + NO_GPS_EXPIRY_MS)).toBeNull();
    expect(expiryReason(snap(), T0 + NO_GPS_EXPIRY_MS + 1)).toBe("no-gps");
    expect(parseSnapshot(serializeSnapshot(snap()), { userId: "u1" }, T0 + NO_GPS_EXPIRY_MS + 1)).toBeNull();
  });
  it("a drive that never got a reading counts from its start", () => { expect(expiryReason(snap({ lastFixAt: null }), T0 + NO_GPS_EXPIRY_MS + 1)).toBe("no-gps"); });
  it("fresh GPS keeps it going, but never beyond 18 hours in all", () => {
    expect(expiryReason(snap({ lastFixAt: T0 + MAX_AGE_MS }), T0 + MAX_AGE_MS)).toBeNull();
    expect(expiryReason(snap({ lastFixAt: T0 + MAX_AGE_MS, savedAt: T0 + MAX_AGE_MS }), T0 + MAX_AGE_MS + 1)).toBe("too-old");
  });
  it("an expired drive is cleaned up when read, and the reason can be told once", () => {
    const st = memStore(); writeDrive(st, snap());
    const later = T0 + NO_GPS_EXPIRY_MS + 1;
    expect(droppedReason(st, "u1", later)).toBe("no-gps");
    expect(readActiveDrive(st, "u1", later)).toBeNull();
    expect(st.m.size).toBe(0);
  });
});

describe("never trusts damaged or foreign data", () => {
  it("garbage, other versions, missing fields: ignored, never throws", () => {
    for (const raw of [null, "", "{", "[]", "null", "5", JSON.stringify({ ...snap(), v: 2 }), JSON.stringify({ ...snap(), session: 0 }), JSON.stringify({ ...snap(), savedAt: "x" })]) {
      expect(() => parseSnapshot(raw, { userId: "u1" }, T0)).not.toThrow();
      expect(parseSnapshot(raw, { userId: "u1" }, T0)).toBeNull();
    }
  });
  it("a straight-line 'route' is never restored as a road route", () => {
    const s = snap({ nav: { armed: true, targetId: "s1", route: { ...route, source: "estimate" } as never } });
    expect(parseSnapshot(serializeSnapshot(s), { userId: "u1" }, T0)?.nav?.route).toBeNull();
  });
  it("a bad camera or screen choice falls back to the default, the drive itself is kept", () => {
    const raw = JSON.stringify({ ...snap(), ui: { focusDay: -4, follow: "yes", camera: { center: [500, 0], zoom: 3, bearing: 0, pitch: 0 } } });
    const p = parseSnapshot(raw, { userId: "u1" }, T0);
    expect(p?.ui).toEqual(DEFAULT_UI); expect(p?.session).toBe(3);
  });
  it("very long road lines are left out rather than filling the phone's storage (they are fetched again)", () => {
    const long = Array.from({ length: 60_000 }, (_, i) => [78.123456 + i * 1e-6, 17.654321] as [number, number]);
    expect(JSON.stringify(long).length).toBeGreaterThan(MAX_SNAPSHOT_CHARS);
    const raw = serializeSnapshot(snap({ driveRoute: { legs: [{ km: 300, minutes: 300 }], line: long, source: "osrm", stopIds: ["s1"], at: T0 } }));
    expect(raw.length).toBeLessThanOrEqual(MAX_SNAPSHOT_CHARS);
    const p = parseSnapshot(raw, { userId: "u1" }, T0);
    expect(p?.driveRoute).toBeNull(); expect(p?.nav?.route).toBeNull(); expect(p?.session).toBe(3);
  });
});

describe("ends cleanly", () => {
  it("Finish / Stop forgets that trip's drive and the active pointer", () => {
    const st = memStore(); writeDrive(st, snap());
    clearDrive(st, "u1", "t1");
    expect(st.m.size).toBe(0);
  });
  it("forgetting another trip leaves the active drive alone", () => {
    const st = memStore(); writeDrive(st, snap());
    clearDrive(st, "u1", "t9");
    expect(readActiveDrive(st, "u1", T0)?.tripId).toBe("t1");
  });
  it("sign-out removes everything THIS person's drives left (drive, arrival answers, remembered stops), and nothing of anyone else's", () => {
    const st = memStore(); writeDrive(st, snap()); writeDrive(st, snap({ userId: "u2" }));
    st.setItem("tm:arrival:u1:t1", "{}"); st.setItem("tm:nav-targets:u1:t1", "{}"); st.setItem("tm:arrival:u2:t1", "{}"); st.setItem("tm:map-theme", "dark");
    expect(clearUserDrives(st, "u1")).toBe(4);
    expect([...st.m.keys()].sort()).toEqual(["tm:arrival:u2:t1", "tm:drive-active:u2", "tm:drive:u2:t1", "tm:map-theme"]);
  });
  it("a deleted trip's drive is removed with the rest of that trip's data", () => {
    const st = memStore(); writeDrive(st, snap());
    forgetTripLocally("t1", st);
    expect(st.getItem(driveKey("u1", "t1"))).toBeNull();
    expect(readActiveDrive(st, "u1", T0)).toBeNull(); // the pointer is left dangling and is cleaned up on read
    expect(st.m.size).toBe(0);
  });
  it("storage that refuses writes never breaks the drive", () => {
    const st = { ...memStore(), setItem: () => { throw new Error("QuotaExceeded"); } };
    expect(writeDrive(st, snap())).toBe(false);
  });
});

describe("one drive at a time", () => {
  it("a different trip must ask first; the same trip, or no drive, need not", () => {
    expect(needsSwitch("t1", "t2")).toBe(true); expect(needsSwitch("t1", "t1")).toBe(false); expect(needsSwitch(null, "t2")).toBe(false);
  });
  it("only one tab may run it: the second tab is told it is taken", async () => {
    const held = new Set<string>();
    const locks = { request: (name: string, _o: { ifAvailable: boolean }, cb: (l: unknown) => Promise<void> | void) => {
      if (held.has(name)) { void cb(null); return Promise.resolve(); }
      held.add(name);
      return Promise.resolve(cb({ name })).then(() => { held.delete(name); });
    } };
    const first = await acquireDriveLock("u1", locks);
    expect(first).toBeTypeOf("function");
    expect(await acquireDriveLock("u1", locks)).toBeNull();
    expect(await acquireDriveLock("u2", locks)).toBeTypeOf("function"); // another person's drive is separate
    first!(); await Promise.resolve(); await Promise.resolve();
    expect(held.has(driveLockName("u1"))).toBe(false);
    expect(await acquireDriveLock("u1", locks)).toBeTypeOf("function");
  });
  it("a browser without Web Locks runs unguarded (as before), never blocked", async () => {
    expect(await acquireDriveLock("u1", undefined)).toBeTypeOf("function");
  });
});

describe("review fixes", () => {
  it("a clock that jumped back does not stretch a drive's life: times in the future are not believed", () => {
    expect(expiryReason(snap({ lastFixAt: T0 + 3_600_000 }), T0)).toBe("too-old");
    expect(expiryReason(snap({ savedAt: T0 + 60_000 }), T0)).toBeNull(); // a minute of drift is fine
  });
  it("damaged or out-of-date saved steps are never handed to navigation", () => {
    const bad = [{ ...route.steps[0], endAlongM: "x" }, { ...route.steps[0], maneuver: null }, { ...route.steps[0], instruction: 5 }];
    for (const step of bad) expect(parseSnapshot(serializeSnapshot(snap({ nav: { armed: true, targetId: "s1", route: { ...route, steps: [step] } as never } })), { userId: "u1" }, T0)?.nav?.route).toBeNull();
    expect(parseSnapshot(serializeSnapshot(snap({ nav: { armed: true, targetId: "s1", route: { ...route, via: undefined } as never } })), { userId: "u1" }, T0)?.nav?.route).toBeNull();
  });
  it("storage full: saved again without the road lines; if even that fails, an OLDER save is removed (it must not come back)", () => {
    const st = memStore(); writeDrive(st, snap({ session: 1 }));
    let calls = 0;
    const tight = { ...st, setItem: (k: string, v: string) => { calls++; if (v.length > 400 && calls === 1) throw new Error("QuotaExceeded"); st.setItem(k, v); } };
    expect(writeDrive(tight, snap({ session: 7 }))).toBe(true);
    const back = parseSnapshot(st.getItem(driveKey("u1", "t1")), { userId: "u1" }, T0);
    expect(back?.session).toBe(7); expect(back?.driveRoute).toBeNull();
    const full = { ...st, setItem: () => { throw new Error("QuotaExceeded"); } };
    expect(writeDrive(full, snap({ session: 8 }))).toBe(false);
    expect(st.getItem(driveKey("u1", "t1"))).toBeNull(); expect(st.getItem(activeDriveKey("u1"))).toBeNull();
  });
  it("sign-out also removes the old per-trip keys from before they were per person (their owner is unknown)", () => {
    const st = memStore(); st.setItem("tm:arrival:t1", "{}"); st.setItem("tm:nav-targets:t1", "{}"); st.setItem("tm:arrival:u2:t1", "{}");
    clearUserDrives(st, "u1");
    expect([...st.m.keys()]).toEqual(["tm:arrival:u2:t1"]);
  });
});
