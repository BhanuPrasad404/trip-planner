// The real useCamera hook driven against a fake camera: permission outcomes, cleanup, fallbacks, and races.
import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCamera } from "@/lib/client/use-camera";
import type { CameraMode } from "@/lib/client/recorder";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type FakeTrack = { kind: string; readyState: string; onended: null | (() => void); stop: () => void };
const makeStream = (kinds: string[] = ["video"]) => {
  const tracks: FakeTrack[] = kinds.map((kind) => ({ kind, readyState: "live", onended: null, stop() { this.readyState = "ended"; } }));
  return { tracks, getTracks: () => tracks, getVideoTracks: () => tracks.filter((t) => t.kind === "video") } as unknown as MediaStream & { tracks: FakeTrack[] };
};

let gumCalls: unknown[];
let gumImpl: (c: unknown) => Promise<MediaStream>;
let video: { srcObject: unknown; play: () => Promise<void>; videoWidth: number; videoHeight: number };
let listeners: Record<string, (() => void)[]>;

beforeEach(() => {
  gumCalls = [];
  gumImpl = async () => makeStream();
  video = { srcObject: null, play: async () => undefined, videoWidth: 640, videoHeight: 480 };
  listeners = {};
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: (c: unknown) => { gumCalls.push(c); return gumImpl(c); }, enumerateDevices: async () => [{ kind: "videoinput" }, { kind: "videoinput" }] },
    permissions: { query: async () => ({ state: "prompt" }) },
  });
  vi.stubGlobal("window", { isSecureContext: true, self: {}, top: undefined });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: (n: string, f: () => void) => { (listeners[n] ??= []).push(f); }, removeEventListener: (n: string, f: () => void) => { listeners[n] = (listeners[n] ?? []).filter((x) => x !== f); } });
  vi.stubGlobal("MediaRecorder", undefined);
});
afterEach(() => vi.unstubAllGlobals());

let cam!: ReturnType<typeof useCamera>;
function Harness({ mode }: { mode: CameraMode }) {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose the hook's latest values
  cam = useCamera(mode, { current: video as unknown as HTMLVideoElement });
  return null;
}
let renderer: TestRenderer.ReactTestRenderer;
const mount = async (mode: CameraMode = "photo") => { await act(async () => { renderer = TestRenderer.create(createElement(Harness, { mode })); }); await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
afterEach(() => { act(() => renderer?.unmount()); });

describe("useCamera — real hook, fake camera", () => {
  it("permission granted: the preview attaches and the screen is 'live' (front/back switching offered with 2 cameras)", async () => {
    await mount("photo");
    expect(cam.state.phase).toBe("live");
    expect(video.srcObject).not.toBeNull();
    expect(cam.state.canSwitch).toBe(true);
    expect(gumCalls[0]).toMatchObject({ audio: false });
  });

  it("video mode asks for the microphone too, and falls back to silent recording ONLY when the microphone is the problem", async () => {
    let n = 0;
    gumImpl = async (c) => { n++; if ((c as { audio: boolean }).audio) throw Object.assign(new Error("mic"), { name: "NotAllowedError" }); return makeStream(); };
    await mount("video");
    expect(cam.state.phase).toBe("live");
    expect(cam.state.notice).toMatch(/without sound/i);
    expect(n).toBe(2);
  });

  it("permission denied after a block set earlier: a clear message with what to do, and no camera is left running", async () => {
    (globalThis as unknown as { navigator: { permissions: unknown } }).navigator.permissions = { query: async () => ({ state: "denied" }) };
    gumImpl = async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); };
    await mount("photo");
    expect(cam.state.phase).toBe("error");
    expect(cam.state.error).toMatch(/blocked the camera for this site/i);
  });

  it("an insecure page is reported as such, not as 'denied'", async () => {
    vi.stubGlobal("window", { isSecureContext: false, self: {}, top: undefined });
    gumImpl = async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); };
    await mount("photo");
    expect(cam.state.error).toMatch(/secure \(https\)/i);
  });

  it("no camera hardware is reported as that", async () => {
    gumImpl = async () => { throw Object.assign(new Error("x"), { name: "NotFoundError" }); };
    await mount("photo");
    expect(cam.state.error).toMatch(/No camera was found/i);
  });

  it("a camera that can't match our resolution is asked again for 'any camera' instead of failing", async () => {
    gumImpl = async (c) => { if (typeof (c as { video: unknown }).video === "object") throw Object.assign(new Error("x"), { name: "OverconstrainedError" }); return makeStream(); };
    await mount("photo");
    expect(cam.state.phase).toBe("live");
    expect(gumCalls).toHaveLength(2);
    expect((gumCalls[1] as { video: unknown }).video).toBe(true);
  });

  it("leaving the screen releases the camera (every track stopped, preview detached)", async () => {
    const s = makeStream(["video", "audio"]);
    gumImpl = async () => s;
    await mount("video");
    expect(s.tracks.every((t) => t.readyState === "live")).toBe(true);
    act(() => renderer.unmount());
    expect(s.tracks.every((t) => t.readyState === "ended")).toBe(true);
    expect(video.srcObject).toBeNull();
  });

  it("a slow permission answer that arrives AFTER leaving the screen is switched off at once (no camera left on)", async () => {
    const s = makeStream();
    let release!: () => void;
    gumImpl = () => new Promise((resolve) => { release = () => resolve(s); });
    await act(async () => { renderer = TestRenderer.create(createElement(Harness, { mode: "photo" })); });
    act(() => renderer.unmount());
    await act(async () => { release(); await Promise.resolve(); });
    expect(s.tracks.every((t) => t.readyState === "ended")).toBe(true);
  });

  it("the camera being taken away while live is reported, not left as a frozen picture", async () => {
    const s = makeStream();
    gumImpl = async () => s;
    await mount("photo");
    await act(async () => { s.tracks[0].readyState = "ended"; s.tracks[0].onended?.(); });
    expect(cam.state.phase).toBe("error");
    expect(cam.state.error).toMatch(/camera stopped/i);
  });

  it("coming back to the app after the phone stopped the camera starts it again by itself", async () => {
    const first = makeStream();
    const second = makeStream();
    let n = 0;
    gumImpl = async () => (n++ === 0 ? first : second);
    await mount("photo");
    first.tracks[0].readyState = "ended"; // the phone stopped it while the app was hidden (no 'ended' event fired)
    await act(async () => { listeners.visibilitychange?.forEach((f) => f()); await Promise.resolve(); await Promise.resolve(); });
    expect(gumCalls).toHaveLength(2);
    expect(video.srcObject).toBe(second);
  });

  it("taking a photo hands over a JPEG and switches the camera off", async () => {
    const s = makeStream();
    gumImpl = async () => s;
    const created: { w: number; h: number }[] = [];
    vi.stubGlobal("document", {
      visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined,
      createElement: () => { const c = { width: 0, height: 0, getContext: () => ({ drawImage: () => created.push({ w: c.width, h: c.height }) }), toBlob: (cb: (b: Blob) => void) => cb(new Blob(["jpg"], { type: "image/jpeg" })) }; return c; },
    });
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:photo", revokeObjectURL: () => undefined });
    await mount("photo");
    await act(async () => { cam.takePhoto(); });
    expect(cam.state.phase).toBe("review");
    expect(cam.state.capture).toMatchObject({ kind: "photo", mime: "image/jpeg" });
    expect(created[0]).toEqual({ w: 640, h: 480 }); // drawn at the camera's own size
    expect(s.tracks[0].readyState).toBe("ended");
  });
});
