"use client";

import { useSyncExternalStore } from "react";

/** `why`: the reason the in-app camera is unavailable, so the page can say it instead of silently hiding the button. */
export type CameraSupport = { photo: boolean; video: boolean; why?: "insecure" | "unsupported" | null };
const none: CameraSupport = { photo: false, video: false, why: null };
let cached: CameraSupport | null = null;

/** What this browser can do. Needs a secure page (https or localhost) and a camera API; video also needs MediaRecorder. */
export function detectCameraSupport(): CameraSupport {
  if (typeof window === "undefined") return none;
  if (cached) return cached;
  const secure = window.isSecureContext !== false;
  const photo = secure && !!navigator.mediaDevices?.getUserMedia;
  cached = { photo, video: photo && typeof MediaRecorder !== "undefined", why: photo ? null : !secure ? "insecure" : "unsupported" };
  return cached;
}
export const useCameraSupport = (): CameraSupport => useSyncExternalStore(() => () => undefined, detectCameraSupport, () => none);
