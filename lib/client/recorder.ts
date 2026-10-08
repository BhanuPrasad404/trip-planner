// The rules of the in-app camera, with no browser in them so they can be tested: what state it is in, how long a clip may be,
// which video format to ask the browser for, and how camera errors are explained. The browser plumbing lives in use-camera.ts.
import { MEDIA_LIMITS } from "@/lib/social/media";

export const MAX_RECORD_MS = MEDIA_LIMITS.videoSeconds * 1000;      // the hard limit: 30 000 ms of RECORDED time (pauses do not count)

/** 17 400 → "00:17". Never shows more than the limit. */
export function formatClock(ms: number): string {
  const s = Math.floor(Math.min(Math.max(ms, 0), MAX_RECORD_MS) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
export const formatLimit = () => formatClock(MAX_RECORD_MS);

// MP4 first (plays everywhere, including in the feed on iPhone), then WebM. Whatever the browser can actually record.
const CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4",
  "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm",
];
export function pickRecorderMime(isSupported: (type: string) => boolean): string | null {
  for (const c of CANDIDATES) { try { if (isSupported(c)) return c; } catch { /* keep looking */ } }
  return null;
}
/** "video/webm;codecs=vp9,opus" → "video/webm". Our upload rules know only the plain types. */
export function plainVideoMime(type: string): "video/mp4" | "video/webm" | null {
  const t = type.split(";")[0].trim().toLowerCase();
  return t === "video/mp4" ? "video/mp4" : t === "video/webm" ? "video/webm" : null;
}

/** Plain-language reasons, each saying what to do next. */
export function cameraErrorMessage(e: unknown): string {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  if (typeof window !== "undefined" && window.isSecureContext === false) return "The camera only works on a secure (https) page. You can still upload from your device.";
  switch (name) {
    case "NotAllowedError": case "PermissionDeniedError": case "SecurityError":
      return "Camera access is blocked. Allow the camera for this site in your browser settings, then try again — or upload from your device.";
    case "NotFoundError": case "DevicesNotFoundError": return "No camera was found on this device. You can upload a photo or video instead.";
    case "NotReadableError": case "TrackStartError": case "AbortError": return "The camera is being used by another app. Close it and try again.";
    case "OverconstrainedError": case "ConstraintNotSatisfiedError": return "This camera can't do what we asked. Try switching cameras.";
    default: return "We couldn't start the camera. You can upload a photo or video from your device instead.";
  }
}

export type CameraMode = "photo" | "video";
export type Facing = "user" | "environment";
export type Capture = { kind: "photo" | "video"; blob: Blob; url: string; durationMs: number; mime: string };
export type RecPhase = "starting" | "live" | "recording" | "paused" | "review" | "error";

export type RecState = {
  phase: RecPhase;
  mode: CameraMode;
  facing: Facing;
  elapsedMs: number;
  capture: Capture | null;
  error: string | null;
  notice: string | null;
  canSwitch: boolean;
  canPause: boolean;
};

export const initialRec = (mode: CameraMode): RecState => ({ phase: "starting", mode, facing: "environment", elapsedMs: 0, capture: null, error: null, notice: null, canSwitch: false, canPause: false });

export type RecAction =
  | { type: "starting" }
  | { type: "ready"; canSwitch: boolean; canPause: boolean; notice?: string | null }
  | { type: "mode"; mode: CameraMode }
  | { type: "facing"; facing: Facing }
  | { type: "record" }
  | { type: "tick"; elapsedMs: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "captured"; capture: Capture; notice?: string | null }
  | { type: "retake" }
  | { type: "failed"; message: string };

export function recReducer(s: RecState, a: RecAction): RecState {
  switch (a.type) {
    case "starting": return { ...s, phase: "starting", error: null, notice: null };
    case "ready": return { ...s, phase: "live", canSwitch: a.canSwitch, canPause: a.canPause, notice: a.notice ?? null, error: null };
    case "mode": return s.phase === "live" ? { ...s, mode: a.mode } : s;                     // cannot change what you are doing mid-recording
    case "facing": return s.phase === "live" || s.phase === "starting" ? { ...s, facing: a.facing } : s;
    case "record": return s.phase === "live" && s.mode === "video" ? { ...s, phase: "recording", elapsedMs: 0, notice: null } : s;
    case "tick": return s.phase === "recording" ? { ...s, elapsedMs: Math.min(Math.max(a.elapsedMs, s.elapsedMs), MAX_RECORD_MS) } : s;   // never goes backwards, never past the limit
    case "pause": return s.phase === "recording" && s.canPause ? { ...s, phase: "paused" } : s;
    case "resume": return s.phase === "paused" ? { ...s, phase: "recording" } : s;
    case "captured": return s.phase === "recording" || s.phase === "paused" || s.phase === "live" ? { ...s, phase: "review", capture: a.capture, elapsedMs: a.capture.durationMs, notice: a.notice ?? null } : s;
    case "retake": return s.phase === "review" ? { ...s, phase: "starting", capture: null, elapsedMs: 0, notice: null } : s;
    case "failed": return { ...s, phase: "error", error: a.message };
  }
}

/** Recorded time so far: time banked before the last pause, plus the running stretch. Pure so the 30 s rule is testable. */
export const elapsedAt = (bankedMs: number, startedAt: number | null, now: number) => Math.min(MAX_RECORD_MS, bankedMs + (startedAt === null ? 0 : Math.max(0, now - startedAt)));
export const reachedLimit = (elapsedMs: number) => elapsedMs >= MAX_RECORD_MS;

/** Sets a recording's known length aside for the upload step (a freshly recorded file often cannot say how long it is). */
export const captureHints = new WeakMap<File, { durationS: number }>();
