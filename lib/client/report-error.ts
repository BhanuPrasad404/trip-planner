"use client";

// Browser side of the alert system: send a short, cleaned description of an unexpected error to /api/client-error.
// Limits: at most 5 reports per page load, the same message only once, and never anything the person typed.
const seen = new Set<string>();
let sent = 0;

export function reportClientError(kind: string, error: unknown): void {
  try {
    if (typeof window === "undefined" || sent >= 5) return;
    const message = (error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error").slice(0, 400);
    const key = `${kind}|${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    const body = JSON.stringify({
      kind,
      message,
      stack: error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 6).join("\n").slice(0, 1500) : undefined,
      path: window.location.pathname.slice(0, 200), // the path only: never the query string or hash
    });
    if (navigator.sendBeacon?.("/api/client-error", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/client-error", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    /* reporting must never cause an error of its own */
  }
}
