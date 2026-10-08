// Batches viewing events so the app sends a handful of small requests, never one per second of video.
// Milestones (impression, play, 25/50/75/100 %) are queued once per post; failures retry twice then are dropped — losing a
// batch only costs a little ranking data, so this must never slow the screen down or show an error.
export type FeedEventType = "impression" | "play" | "q25" | "q50" | "q75" | "complete" | "replay" | "skip" | "leave";
export type QueuedEvent = { post_id: string; type: FeedEventType; ms?: number };

const MILESTONES = new Set<FeedEventType>(["impression", "play", "q25", "q50", "q75", "complete"]);

export type EventQueueOptions = {
  /** Resolve true when the server accepted the batch. */
  send: (events: QueuedEvent[], opts: { keepalive: boolean }) => Promise<boolean>;
  flushEveryMs?: number;
  maxBatch?: number;
  maxQueue?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
};

export function createEventQueue(o: EventQueueOptions) {
  const flushEvery = o.flushEveryMs ?? 6000;
  const maxBatch = o.maxBatch ?? 20;
  const maxQueue = o.maxQueue ?? 200;
  const setTimer = o.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearInterval(t as ReturnType<typeof setInterval>));

  let queue: (QueuedEvent & { tries?: number })[] = [];
  const sentOnce = new Set<string>();
  let flushing = false;
  let timer: unknown = null;

  async function flush(keepalive = false): Promise<void> {
    if (flushing || queue.length === 0) return;
    flushing = true;
    const batch = queue.slice(0, 50);
    queue = queue.slice(batch.length);
    let ok = false;
    try { ok = await o.send(batch.map(({ post_id, type, ms }) => ({ post_id, type, ...(ms ? { ms } : {}) })), { keepalive }); } catch { ok = false; }
    if (!ok) {
      const retry = batch.map((e) => ({ ...e, tries: (e.tries ?? 0) + 1 })).filter((e) => e.tries <= 2);
      queue = [...retry, ...queue].slice(-maxQueue);
    }
    flushing = false;
  }

  return {
    track(postId: string, type: FeedEventType, ms?: number) {
      if (MILESTONES.has(type)) {
        const k = `${postId}:${type}`;
        if (sentOnce.has(k)) return;
        sentOnce.add(k);
      }
      queue.push({ post_id: postId, type, ...(ms && ms > 0 ? { ms: Math.min(Math.round(ms), 120_000) } : {}) });
      if (queue.length > maxQueue) queue = queue.slice(-maxQueue);
      if (queue.length >= maxBatch) void flush();
    },
    flush,
    start() { if (timer == null) timer = setTimer(() => void flush(), flushEvery); },
    stop() { if (timer != null) { clearTimer(timer); timer = null; } },
    pending: () => queue.length,
  };
}
