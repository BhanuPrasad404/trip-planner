"use client";

import type { CameraEnv } from "./recorder";

type PolicyDoc = Document & { permissionsPolicy?: { allowsFeature: (f: string) => boolean }; featurePolicy?: { allowsFeature: (f: string) => boolean } };

/** What the browser can tell us about why a camera request may have failed. Every probe is optional: no support → null. */
export async function readCameraEnv(): Promise<CameraEnv> {
  const secure = window.isSecureContext !== false;
  const hasApi = !!navigator.mediaDevices?.getUserMedia;
  let embedded = false;
  try { embedded = window.self !== window.top; } catch { embedded = true; } // cross-origin parent: reading it throws
  let policyAllows: boolean | null = null;
  try {
    const pp = (document as PolicyDoc).permissionsPolicy ?? (document as PolicyDoc).featurePolicy;
    if (pp?.allowsFeature) policyAllows = pp.allowsFeature("camera");
  } catch { /* leave null */ }
  let permission: CameraEnv["permission"] = null;
  try {
    const r = await navigator.permissions?.query({ name: "camera" as PermissionName });
    if (r && (r.state === "granted" || r.state === "denied" || r.state === "prompt")) permission = r.state;
  } catch { /* Safari/Firefox variants may refuse the query: unknown */ }
  return { secure, hasApi, embedded, policyAllows, permission };
}
