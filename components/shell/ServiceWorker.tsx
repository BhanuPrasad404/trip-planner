"use client";

import { useEffect } from "react";
import { registerAlertWorker } from "@/lib/client/alert-channels";

/**
 * Registers Trailmate's service worker (public/sw.js) once the app has opened, so everyone gets the friendly offline page instead of
 * the browser's error. The worker itself is unchanged: it caches ONLY /offline.html, never a signed-in page, an API answer or any
 * private data, and it shows notifications only after the person turned alerts on. Registering asks for no permission at all.
 */
export function ServiceWorker() {
  useEffect(() => {
    const go = () => void registerAlertWorker();
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
    return () => window.removeEventListener("load", go);
  }, []);
  return null;
}
