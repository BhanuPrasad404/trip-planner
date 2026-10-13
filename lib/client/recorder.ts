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

/** What the page knows about its own situation. Read once when a camera error happens (see camera-env.ts). */
export type CameraEnv = {
  secure: boolean;
  hasApi: boolean;
  /** The page sits inside another page (an iframe). Browsers then need the embedder's permission too. */
  embedded: boolean;
  /** Does the site's Permissions-Policy allow the camera at all? null = this browser can't tell. */
  policyAllows: boolean | null;
  /** The browser's saved answer for this site. null = this browser can't tell. */
  permission: "granted" | "denied" | "prompt" | null;
};
export type CameraProblem = "insecure" | "unsupported" | "policy" | "embedded" | "denied" | "dismissed" | "no-camera" | "in-use" | "constraints" | "unknown";

/**
 * The real reason the camera failed, and what the person can do about it. "Blocked" used to cover five different things
 * (a site-wide policy, a block they chose earlier, a prompt they closed, an embedded frame, a missing permission API),
 * and the advice for each is different — so they are told apart here.
 */
export function diagnoseCamera(e: unknown, env: CameraEnv | null): { problem: CameraProblem; message: string } {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  const upload = "You can still upload from your device.";
  if (env && !env.secure) return { problem: "insecure", message: `The camera only works on a secure (https) page, and this one isn't. ${upload}` };
  if (env && !env.hasApi) return { problem: "unsupported", message: `This browser doesn't offer camera access to web pages. Try Chrome, Safari or Edge. ${upload}` };
  switch (name) {
    case "NotAllowedError": case "PermissionDeniedError": case "SecurityError":
      if (env?.policyAllows === false) return { problem: "policy", message: `This page isn't allowed to use the camera — that is a setting of the site, not something you can change in your browser. ${upload}` };
      if (env?.embedded && env.permission !== "denied") return { problem: "embedded", message: `The camera can't be used while this page is shown inside another page. Open it in its own tab, or upload from your device.` };
      if (env?.permission === "denied") return { problem: "denied", message: "You have blocked the camera for this site. Tap the lock (or settings) icon next to the address, set Camera to Allow, then try again — or upload from your device." };
      if (env?.permission === "prompt") return { problem: "dismissed", message: "The camera wasn't allowed. Tap Try again and choose Allow when your browser asks — or upload from your device." };
      return { problem: "denied", message: "Camera access is blocked. Allow the camera for this site in your browser settings, then try again — or upload from your device." };
    case "NotFoundError": case "DevicesNotFoundError": return { problem: "no-camera", message: "No camera was found on this device. You can upload a photo or video instead." };
    case "NotReadableError": case "TrackStartError": case "AbortError": return { problem: "in-use", message: "The camera is being used by another app. Close it and try again." };
    case "OverconstrainedError": case "ConstraintNotSatisfiedError": return { problem: "constraints", message: "This camera can't do what we asked. Try switching cameras." };
    default: return { problem: "unknown", message: `We couldn't start the camera. ${upload}` };
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
