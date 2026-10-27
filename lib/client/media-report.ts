// When a picture or video fails to load on the phone, tell the server (it prints it in the terminal / monitoring), so a broken photo
// is never a silent empty box. Never sends the signed link's secret part: only the site, the file's folder and the kind of failure.
// At most a few reports per page visit.
let sent = 0;
const MAX = 5;

/** The part of a link that is safe to log: host + path, without the signature (?token=…). */
export function safeLink(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "blob:" || u.protocol === "data:") return u.protocol.slice(0, -1);   // a local picture: nothing about it to log
    if (u.protocol !== "https:" && u.protocol !== "http:") return "unparseable link";
    return `${u.host}${u.pathname.split("/").slice(0, 7).join("/")}`;
  } catch { return "unparseable link"; }
}

export function reportMediaFailure(kind: "image" | "video", url: string, postId: string): void {
  if (typeof window === "undefined" || sent >= MAX) return;
  sent++;
  const body = JSON.stringify({ kind: "media", message: `${kind} failed to load for post ${postId}: ${safeLink(url)}`, path: window.location.pathname.slice(0, 200) });
  void fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}

export const resetMediaReports = () => { sent = 0; };
