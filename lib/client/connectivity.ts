// Is this device really connected to Trailmate's server?
//
// `navigator.onLine` is only half an answer. It says "offline" reliably (airplane mode, no Wi-Fi), but "online" only means "a network
// interface is up": Wi-Fi with no internet, a captive portal, a dead mobile signal in a tunnel and a stalled VPN all report `true`.
// So this module treats the browser's flag as a HINT and settles the question with a tiny request to our own server (GET /api/ping).
//
//   offline   the browser says so, OR two probes in a row got no HTTP answer at all.
//   online    a probe got an answer. (Any HTTP status counts: a 500 means the network works and our server is unhappy, a different problem.)
//
// Design rules that keep the screen honest and calm:
//   • One failed request never flips the app to "offline" (a single dropped packet is not a disconnection): a failure only asks for a
//     second look, and two misses in a row are needed. The browser's own "offline" event IS trusted at once.
//   • "Online" is never trusted without a check after an outage: the `online` event only starts a probe.
//   • While offline we retry with growing, jittered pauses (2 s → 30 s) so a thousand phones leaving a tunnel do not hit the server together.
//   • Probes stop while the tab is hidden (no battery or data used for a page nobody is looking at) and run again as soon as it is shown.
//   • Everything time- or network-related is injected, so the whole state machine is tested without a browser.

export type NetStatus = "online" | "offline";
export type NetSnapshot = {
  status: NetStatus;
  /** A probe is running right now (shown as "Checking…"). */
  checking: boolean;
  /** When the current status began (ms since epoch). */
  since: number;
  /** Set when we came back online after being offline; cleared by `acknowledgeRecovery`. Drives the short "Back online" message. */
  recovery: { offlineMs: number; at: number } | null;
  /** When the next automatic retry will happen while offline (ms since epoch), or null. */
  nextRetryAt: number | null;
  /** Failed probes in a row (0 while healthy). */
  failures: number;
};

export type ConnectivityDeps = {
  /** Resolves true if the server answered (any HTTP status), false if the network failed or timed out. Must never throw. */
  probe: () => Promise<boolean>;
  now: () => number;
  /** The browser's own flag. */
  browserOnline: () => boolean;
  pageVisible: () => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
  random: () => number;
};

export const RETRY_FIRST_MS = 2_000;
export const RETRY_MAX_MS = 30_000;
/** A healthy, visible page re-checks this often: it is what notices "Wi-Fi with no internet" without any user action. */
export const HEARTBEAT_MS = 60_000;
/** Gap before the confirming second probe after the first miss. */
export const CONFIRM_MS = 1_500;
/** Misses in a row (while believed online) before we call it offline. */
export const MISSES_TO_OFFLINE = 2;

/** The pause before retry number `attempt` (1-based): 2 s, 4 s, 8 s, 16 s, 30 s, 30 s … with ±20 % jitter, never above the cap. */
export function retryDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.max(0, attempt - 1));
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.min(RETRY_MAX_MS, Math.max(500, Math.round(base * jitter)));
}

export type Connectivity = ReturnType<typeof createConnectivity>;

export function createConnectivity(deps: ConnectivityDeps) {
  let snap: NetSnapshot = { status: deps.browserOnline() ? "online" : "offline", checking: false, since: deps.now(), recovery: null, nextRetryAt: null, failures: 0 };
  const listeners = new Set<() => void>();
  let timer: unknown = null;
  let running = false;
  let started = false;
  let inFlight: Promise<void> | null = null;
  let generation = 0; // bumped on stop(): a probe that finishes after stop must not touch state

  const emit = () => { for (const l of [...listeners]) l(); };
  const set = (patch: Partial<NetSnapshot>) => { snap = { ...snap, ...patch }; emit(); };
  const clear = () => { if (timer !== null) { deps.clearTimer(timer); timer = null; } if (snap.nextRetryAt !== null) { snap = { ...snap, nextRetryAt: null }; } };

  function schedule(ms: number, kind: "retry" | "heartbeat" | "confirm") {
    clear();
    const at = deps.now() + ms;
    timer = deps.setTimer(() => { timer = null; void check(); }, ms);
    if (kind === "retry") set({ nextRetryAt: at }); else if (snap.nextRetryAt !== null) set({ nextRetryAt: null });
  }

  function planNext() {
    if (!running) return;
    if (snap.status === "offline") schedule(retryDelay(Math.max(1, snap.failures), deps.random), "retry");
    else if (snap.failures > 0) schedule(CONFIRM_MS, "confirm");
    else schedule(HEARTBEAT_MS, "heartbeat");
  }

  function goOnline() {
    const wasOffline = snap.status === "offline";
    const now = deps.now();
    set({ status: "online", checking: false, failures: 0, nextRetryAt: null, since: wasOffline ? now : snap.since, recovery: wasOffline ? { offlineMs: now - snap.since, at: now } : snap.recovery });
  }

  function goOffline() {
    if (snap.status === "offline") { set({ checking: false }); return; }
    set({ status: "offline", checking: false, since: deps.now(), recovery: null, nextRetryAt: null });
  }

  /** One probe. Overlapping calls share the same one. */
  function check(): Promise<void> {
    if (inFlight) return inFlight;
    if (!deps.pageVisible()) { return Promise.resolve(); } // a hidden tab waits; `visibilitychange` re-checks
    const gen = generation;
    clear();
    set({ checking: true });
    inFlight = (async () => {
      let ok = false;
      try { ok = await deps.probe(); } catch { ok = false; }
      if (gen !== generation) return;
      if (ok) { goOnline(); }
      else {
        const failures = snap.failures + 1;
        if (snap.status === "offline") set({ failures, checking: false });
        else if (failures >= MISSES_TO_OFFLINE) { set({ failures }); goOffline(); }
        else set({ failures, checking: false });
      }
      planNext();
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    getSnapshot: (): NetSnapshot => snap,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },

    /** Begin watching. Idempotent. */
    start() {
      if (running) return;
      running = true;
      started = true;
      if (!deps.browserOnline()) goOffline();
      if (snap.status === "offline") void check(); else planNext();
    },
    stop() { running = false; generation++; inFlight = null; clear(); set({ checking: false }); },

    /** The browser fired `offline`: believed at once. */
    browserOffline() { if (!running) return; goOffline(); void check(); },
    /** The browser fired `online`: only a hint. Confirm with a probe before saying anything. */
    browserOnline() { if (!running) return; void check(); },
    /** The tab was shown again (the clock and the network may both have changed while hidden). */
    pageShown() { if (running) void check(); },
    /** A real request just failed with no HTTP answer. Ask for a second look; two misses in a row are needed to call it offline. */
    requestFailed() {
      if (!running || snap.status === "offline") return;
      void check();
    },
    /** The person pressed "Try again". */
    retryNow(): Promise<void> { clear(); return check(); },
    /** The "Back online" message was shown or dismissed. */
    acknowledgeRecovery() { if (snap.recovery) set({ recovery: null }); },
    /** True once start() has been called (for tests and for the guard). */
    get started() { return started; },
  };
}

// ── The fetch guard ───────────────────────────────────────────────────────────────────────────────────────────────
// Requests to our own /api while the device is known to be offline fail AT ONCE with a plain message, instead of hanging until the
// browser times out and then showing "Something went wrong". Failures with no answer feed back into the connectivity check.

export class OfflineError extends Error {
  readonly offline = true;
  constructor(message = "You're offline. This needs an internet connection — try again when you're back online.") { super(message); this.name = "OfflineError"; }
}
export const isOfflineError = (e: unknown): e is OfflineError => e instanceof OfflineError || (typeof e === "object" && e !== null && (e as { offline?: unknown }).offline === true);

/** Same-origin API calls are guarded; the connectivity probe itself, other sites and everything else pass straight through. */
export function isGuardedRequest(input: RequestInfo | URL, origin: string): boolean {
  let url: URL;
  try { url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url, origin); } catch { return false; }
  return url.origin === origin && url.pathname.startsWith("/api/") && url.pathname !== PING_PATH;
}
export const PING_PATH = "/api/ping";

export function guardedFetch(base: typeof fetch, c: Pick<Connectivity, "getSnapshot" | "requestFailed">, origin: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isGuardedRequest(input, origin)) return base(input, init);
    if (c.getSnapshot().status === "offline") throw new OfflineError();
    try {
      return await base(input, init);
    } catch (e) {
      // An aborted request (the person navigated away, a timeout we set ourselves) says nothing about the network.
      const aborted = typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
      if (!aborted) c.requestFailed();
      throw e;
    }
  }) as typeof fetch;
}

/** The real probe: a tiny uncached request to our own server with a hard timeout. Never throws. */
export function makeProbe(fetchImpl: typeof fetch, timeoutMs = 4_000): () => Promise<boolean> {
  return async () => {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      await fetchImpl(`${PING_PATH}?t=${Date.now()}`, { method: "GET", cache: "no-store", credentials: "omit", signal: ctl?.signal });
      return true; // any HTTP answer means the network path works
    } catch {
      return false;
    } finally {
      if (t !== null) clearTimeout(t);
    }
  };
}
