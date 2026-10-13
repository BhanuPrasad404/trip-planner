"use client";

import type { LocationEnv } from "@/lib/location/permission";

type PolicyDoc = Document & { permissionsPolicy?: { allowsFeature: (f: string) => boolean }; featurePolicy?: { allowsFeature: (f: string) => boolean } };

/** What the browser can tell us about why a location request may have failed. Every probe is optional: no support → null. */
export async function readLocationEnv(): Promise<LocationEnv> {
  const secure = window.isSecureContext !== false;
  const hasApi = !!navigator.geolocation;
  let embedded = false;
  try { embedded = window.self !== window.top; } catch { embedded = true; }
  let policyAllows: boolean | null = null;
  try {
    const pp = (document as PolicyDoc).permissionsPolicy ?? (document as PolicyDoc).featurePolicy;
    if (pp?.allowsFeature) policyAllows = pp.allowsFeature("geolocation");
  } catch { /* leave null */ }
  let permission: LocationEnv["permission"] = null;
  try {
    const r = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (r && (r.state === "granted" || r.state === "denied" || r.state === "prompt")) permission = r.state;
  } catch { /* some browsers refuse the query: unknown */ }
  return { secure, hasApi, embedded, policyAllows, permission };
}
