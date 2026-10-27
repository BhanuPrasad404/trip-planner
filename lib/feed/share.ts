// Sharing a post: one address per post (so it can be sent on WhatsApp and opened later), and the share sheet of the phone when there
// is one, a copied link when there is not. The browser pieces are passed in, so every branch is tested without a browser.
import type { FeedItemDTO } from "./map";

export const postPath = (id: string) => `/discover/${id}`;
export const postUrl = (origin: string, id: string) => `${origin.replace(/\/+$/, "")}${postPath(id)}`;

type Shareable = Pick<FeedItemDTO, "id" | "destination" | "placeName" | "freshness" | "experience">;

export function shareContent(item: Shareable, origin: string): { title: string; text: string; url: string } {
  const spot = item.placeName && item.placeName.toLowerCase() !== item.destination.name.toLowerCase() ? `, ${item.placeName}` : "";
  const when = item.freshness.usableAsCurrent ? `What it's like now (${item.freshness.label})` : "A traveler's photo";
  return { title: `${item.destination.name}${spot} on Trailmate`, text: `${when}: ${item.destination.name}${spot}`, url: postUrl(origin, item.id) };
}

export type ShareEnv = {
  origin: string;
  share?: (data: { title: string; text: string; url: string }) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
};
export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

export async function sharePost(item: Shareable, env: ShareEnv): Promise<ShareResult> {
  const data = shareContent(item, env.origin);
  if (env.share) {
    try { await env.share(data); return "shared"; }
    catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";   // the person closed the share sheet: not an error
      /* the share sheet failed for another reason: fall through to copying the link */
    }
  }
  if (env.writeText) {
    try { await env.writeText(data.url); return "copied"; } catch { /* no clipboard permission */ }
  }
  return "failed";
}

/** The real browser's pieces (only call this in the browser). */
export const browserShareEnv = (): ShareEnv => ({
  origin: window.location.origin,
  share: typeof navigator.share === "function" ? (d) => navigator.share(d) : undefined,
  writeText: navigator.clipboard?.writeText ? (t) => navigator.clipboard.writeText(t) : undefined,
});

/** A traveler's own page. Usernames are lower-case letters, numbers and _ (the database enforces it), so they are safe in a path. */
export const travelerPath = (username: string) => `/discover/u/${encodeURIComponent(username.toLowerCase())}`;
