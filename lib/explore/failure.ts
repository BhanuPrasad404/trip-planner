// Why a map lookup failed, in words a traveller (and a developer) can act on. The map servers' answers are things like
// "all map servers failed: overpass-api.de -> HTTP 429; overpass.kumi.systems -> TimeoutError"; this reads them, never guesses beyond them.
export type MapFailureKind = "rate_limited" | "refused" | "timeout" | "unreachable" | "server_error" | "unknown";
export type MapFailure = { kind: MapFailureKind; /** For the traveller: no jargon. */ note: string; /** For whoever runs the server: what to do about it. */ hint: string };

const NETWORK = /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network|UND_ERR|TypeError/i;

export function classifyMapFailure(reason: string): MapFailure {
  const parts = reason.replace(/^all map servers failed:\s*/i, "").split(/;\s*/).map((p) => p.trim()).filter((p) => p && !/^\(waited/.test(p));
  const any = (re: RegExp) => parts.some((p) => re.test(p));
  if (parts.length > 0 && parts.every((p) => NETWORK.test(p) && !/HTTP \d{3}/.test(p))) {
    return { kind: "unreachable", note: "We can't reach the map service from here. Check your internet connection and try again.", hint: "None of the map servers could be reached (no HTTP answer): a network, firewall or DNS problem on the machine running the server." };
  }
  if (any(/HTTP 429|too many requests|rate_limited/i)) {
    return { kind: "rate_limited", note: "The free map service is busy with other requests right now. Give it a minute and try again.", hint: "A public Overpass server answered 'too many requests' (HTTP 429): it allows about two questions at a time per address. Wait a minute, or set OVERPASS_URL to your own Overpass server (see docs/LAUNCH_CHECKLIST.md)." };
  }
  if (any(/HTTP (403|406)/)) {
    return { kind: "refused", note: "The free map service isn't answering requests from our server right now. Try again later, or add places yourself.", hint: "A public Overpass server refused the request (HTTP 403/406): its front door rejects this client or address. Retrying soon will not help; failed servers are skipped for 5 minutes (lib/overpass-health.ts). Set GEOCODER_USER_AGENT to an identity with a contact address, test from another network, or set OVERPASS_URL to your own server." };
  }
  if (any(/TimeoutError|HTTP 504|timed out|deadline|slow/i)) {
    return { kind: "timeout", note: "The free map service is taking too long to answer for this area. Try again in a minute.", hint: "The map servers did not answer in time (timeout / HTTP 504). A wide search over a busy public server can do this; the answer is cached once it works, so a retry is usually quick." };
  }
  if (any(/HTTP 5\d\d/)) {
    return { kind: "server_error", note: "The map service is having trouble right now. Try again in a minute.", hint: "A map server answered with a server error (HTTP 5xx)." };
  }
  return { kind: "unknown", note: "We couldn't look this up just now. Try again in a minute.", hint: "The map lookup failed for a reason we don't recognise; see the line above." };
}
