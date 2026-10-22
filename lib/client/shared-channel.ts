// ONE Realtime channel per topic on this page, shared by every screen that listens (the drive runs app-wide, so it and the trip's own
// pages can listen to the same trip at once). Supabase hands back the SAME channel object for the same topic, including one that is
// still LEAVING (removeChannel is asynchronous), and listeners added to it are torn down with it. So:
//   • every screen registers its listener here, never on the channel;
//   • the channel closes a moment AFTER the last screen leaves, so a hand-off (one screen unmounts, another mounts in the same commit,
//     or a quick back/forward) keeps the same joined channel;
//   • a screen that arrives while the old channel is still being removed gets a fresh one once that removal has finished.
import type { createClient } from "@/lib/supabase/client";

type Sb = Pick<ReturnType<typeof createClient>, "channel" | "removeChannel">;
export type Channel = ReturnType<Sb["channel"]>;

/** How long a channel nobody listens to stays open. */
export const LINGER_MS = 5_000;

type Entry<K extends string> = { channel: Channel | null; subs: Record<K, Set<() => void>>; closeTimer: ReturnType<typeof setTimeout> | null };

/**
 * A pool of shared channels. `build` creates the channel (not subscribed) and wires its events to `emit(kind)`; listeners join per
 * kind. Returns `join(sb, key, kind, fn)`, which returns `leave()`.
 */
export function sharedChannelPool<K extends string>(kinds: readonly K[], build: (sb: Sb, key: string, emit: (kind: K) => void) => Channel) {
  const open = new Map<string, Entry<K>>();
  const closing = new Map<string, Promise<unknown>>();

  return function join(sb: Sb, key: string, kind: K, fn: () => void): () => void {
    let e = open.get(key);
    if (!e) {
      const created: Entry<K> = { channel: null, subs: Object.fromEntries(kinds.map((k) => [k, new Set()])) as Entry<K>["subs"], closeTimer: null };
      open.set(key, created);
      const start = () => {
        if (open.get(key) !== created) return; // everyone left before it could open
        created.channel = build(sb, key, (k) => created.subs[k].forEach((f) => f()));
        created.channel.subscribe();
      };
      const prev = closing.get(key);
      if (prev) void prev.then(start, start); else start();
      e = created;
    }
    const entry = e;
    if (entry.closeTimer) { clearTimeout(entry.closeTimer); entry.closeTimer = null; }
    entry.subs[kind].add(fn);

    let left = false;
    return () => {
      if (left) return;
      left = true;
      entry.subs[kind].delete(fn);
      if (kinds.some((k) => entry.subs[k].size > 0) || open.get(key) !== entry) return;
      entry.closeTimer = setTimeout(() => {
        entry.closeTimer = null;
        if (kinds.some((k) => entry.subs[k].size > 0) || open.get(key) !== entry) return;
        open.delete(key);
        if (!entry.channel) return;
        const done: Promise<unknown> = Promise.resolve().then(() => sb.removeChannel(entry.channel!)).catch(() => undefined)
          .finally(() => { if (closing.get(key) === done) closing.delete(key); });
        closing.set(key, done);
      }, LINGER_MS);
    };
  };
}
