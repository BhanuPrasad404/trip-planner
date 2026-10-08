import { describe, expect, it } from "vitest";
import { cameraErrorMessage, elapsedAt, formatClock, formatLimit, initialRec, MAX_RECORD_MS, pickRecorderMime, plainVideoMime, reachedLimit, recReducer, type Capture, type RecState } from "@/lib/client/recorder";

const cap = (kind: "photo" | "video", ms = 8000): Capture => ({ kind, blob: new Blob(["x"]), url: "blob:x", durationMs: ms, mime: kind === "photo" ? "image/jpeg" : "video/mp4" });
const run = (s: RecState, ...actions: Parameters<typeof recReducer>[1][]) => actions.reduce(recReducer, s);
const live = (mode: "photo" | "video" = "video", canPause = true) => run(initialRec(mode), { type: "ready", canSwitch: true, canPause });

describe("the 30-second rule", () => {
  it("the limit is exactly 30 seconds and the clock never shows more", () => {
    expect(MAX_RECORD_MS).toBe(30_000);
    expect(formatLimit()).toBe("00:30");
    expect(formatClock(0)).toBe("00:00"); expect(formatClock(3_000)).toBe("00:03"); expect(formatClock(17_400)).toBe("00:17");
    expect(formatClock(29_999)).toBe("00:29"); expect(formatClock(30_000)).toBe("00:30"); expect(formatClock(95_000)).toBe("00:30"); expect(formatClock(-5)).toBe("00:00");
  });
  it("recorded time = banked time + the running stretch, capped at the limit; pauses do not count", () => {
    expect(elapsedAt(0, 1000, 3500)).toBe(2500);
    expect(elapsedAt(12_000, 5000, 8000)).toBe(15_000);               // 12 s before the pause, 3 s since resuming
    expect(elapsedAt(12_000, null, 99_999)).toBe(12_000);             // paused: the clock is frozen
    expect(elapsedAt(29_000, 0, 9_000)).toBe(30_000);                 // can never exceed 30 s
    expect(elapsedAt(0, 5000, 4000)).toBe(0);                         // a clock that steps backwards cannot produce negative time
    expect(reachedLimit(29_999)).toBe(false); expect(reachedLimit(30_000)).toBe(true);
  });
  it("any length up to the limit is a valid recording (3, 8, 17, 25 and 30 seconds)", () => {
    for (const ms of [3000, 8000, 17_000, 25_000, 30_000]) {
      const s = run(live(), { type: "record" }, { type: "tick", elapsedMs: ms }, { type: "captured", capture: cap("video", ms) });
      expect(s.phase).toBe("review"); expect(s.capture!.durationMs).toBe(ms);
    }
  });
});

describe("recording state machine", () => {
  it("record needs a live camera in video mode; stop keeps the clip and goes to review", () => {
    expect(recReducer(initialRec("video"), { type: "record" }).phase).toBe("starting");          // camera not ready yet
    expect(recReducer(live("photo"), { type: "record" }).phase).toBe("live");                    // photo mode does not record
    const rec = run(live(), { type: "record" }, { type: "tick", elapsedMs: 4200 });
    expect(rec.phase).toBe("recording"); expect(rec.elapsedMs).toBe(4200);
    const done = recReducer(rec, { type: "captured", capture: cap("video", 4200) });
    expect(done.phase).toBe("review"); expect(done.capture).not.toBeNull();                      // Stop never loses the media
  });
  it("time only moves forward and is clamped to the limit", () => {
    const rec = run(live(), { type: "record" }, { type: "tick", elapsedMs: 9000 }, { type: "tick", elapsedMs: 2000 }, { type: "tick", elapsedMs: 99_000 });
    expect(rec.elapsedMs).toBe(30_000);
    expect(recReducer(live(), { type: "tick", elapsedMs: 5000 }).elapsedMs).toBe(0);              // ticks are ignored when not recording
  });
  it("pause/resume works only while recording and only when the browser supports pausing", () => {
    const rec = run(live(), { type: "record" });
    expect(recReducer(rec, { type: "pause" }).phase).toBe("paused");
    expect(recReducer(recReducer(rec, { type: "pause" }), { type: "resume" }).phase).toBe("recording");
    expect(run(live("video", false), { type: "record" }, { type: "pause" }).phase).toBe("recording");
    expect(recReducer(live(), { type: "pause" }).phase).toBe("live");
  });
  it("a paused clip can still be stopped and kept", () => {
    const s = run(live(), { type: "record" }, { type: "tick", elapsedMs: 6000 }, { type: "pause" }, { type: "captured", capture: cap("video", 6000) });
    expect(s.phase).toBe("review");
  });
  it("mode and camera cannot be changed mid-recording", () => {
    const rec = run(live(), { type: "record" });
    expect(recReducer(rec, { type: "mode", mode: "photo" }).mode).toBe("video");
    expect(recReducer(rec, { type: "facing", facing: "user" }).facing).toBe("environment");
    expect(recReducer(live(), { type: "mode", mode: "photo" }).mode).toBe("photo");
    expect(recReducer(live(), { type: "facing", facing: "user" }).facing).toBe("user");
  });
  it("retake clears the capture and restarts the camera; a photo is captured straight from live", () => {
    const photo = run(live("photo"), { type: "captured", capture: cap("photo") });
    expect(photo.phase).toBe("review");
    const again = recReducer(photo, { type: "retake" });
    expect(again.phase).toBe("starting"); expect(again.capture).toBeNull(); expect(again.elapsedMs).toBe(0);
    expect(recReducer(live(), { type: "retake" }).phase).toBe("live");                          // nothing to retake yet
  });
  it("failures are shown, and a notice can explain why a clip ended early", () => {
    expect(recReducer(live(), { type: "failed", message: "boom" })).toMatchObject({ phase: "error", error: "boom" });
    const s = run(live(), { type: "record" }, { type: "captured", capture: cap("video", 2000), notice: "Recording stopped because you left the app" });
    expect(s.notice).toMatch(/left the app/);
  });
});

describe("format and errors", () => {
  it("prefers MP4, falls back to WebM, and says null when the browser cannot record at all", () => {
    expect(pickRecorderMime((t) => t.startsWith("video/mp4"))).toMatch(/^video\/mp4/);
    expect(pickRecorderMime((t) => t === "video/webm;codecs=vp9,opus")).toBe("video/webm;codecs=vp9,opus");
    expect(pickRecorderMime(() => false)).toBeNull();
    expect(pickRecorderMime(() => { throw new Error("nope"); })).toBeNull();
  });
  it("turns the browser's codec-laden type into the plain types the upload rules accept", () => {
    expect(plainVideoMime("video/webm;codecs=vp9,opus")).toBe("video/webm");
    expect(plainVideoMime("video/mp4;codecs=avc1.42E01E,mp4a.40.2")).toBe("video/mp4");
    expect(plainVideoMime("video/quicktime")).toBeNull(); expect(plainVideoMime("")).toBeNull();
  });
  it("explains camera problems in words that say what to do", () => {
    expect(cameraErrorMessage({ name: "NotAllowedError" })).toMatch(/blocked.*settings/i);
    expect(cameraErrorMessage({ name: "NotFoundError" })).toMatch(/No camera/);
    expect(cameraErrorMessage({ name: "NotReadableError" })).toMatch(/another app/);
    expect(cameraErrorMessage({ name: "OverconstrainedError" })).toMatch(/switching cameras/);
    expect(cameraErrorMessage(new Error("???"))).toMatch(/upload/i);
    expect(cameraErrorMessage(null)).toMatch(/upload/i);
  });
});
