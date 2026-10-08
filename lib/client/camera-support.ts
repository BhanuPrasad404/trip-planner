"use client";

import { useSyncExternalStore } from "react";

export type CameraSupport = { photo: boolean; video: boolean };
const none: CameraSupport = { photo: false, video: false };
let cached: CameraSupport | null = null;

/** What this browser can do. Needs a secure page (https or localhost) and a camera API; video also needs MediaRecorder. */
export function detectCameraSupport(): CameraSupport {
  if (typeof window === "undefined") return none;
  if (cached) return cached;
  const photo = window.isSecureContext !== false && !!navigator.mediaDevices?.getUserMedia;
  cached = { photo, video: photo && typeof MediaRecorder !== "undefined" };
  return cached;
}
export const useCameraSupport = (): CameraSupport => useSyncExternalStore(() => () => undefined, detectCameraSupport, () => none);
