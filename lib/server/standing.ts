// Standing for the authors on one page: ONE database call per page, with a short memory per server instance so a busy author is not
// recounted on every page. Best effort: if it fails, the posts still show, just without badges.
import type { SupabaseClient } from "@supabase/supabase-js";
import { toStanding, type Standing, type StandingRow } from "@/lib/social/standing";

const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 5_000;
const memo = new Map<string, { at: number; s: Standing }>();

/** Forget everything (tests, and after the person's own counts change). */
export const forgetStanding = (ids?: string[]) => { if (!ids) memo.clear(); else for (const id of ids) memo.delete(id); };

/**
 * The memory is shared by EVERY viewer on this server, so it keeps only what is the same for everyone (travelers helped, posts,
 * badge, place). Follower numbers depend on who is looking (you always see your own, others may not), so they are never kept:
 * ask with `withFollows` (a profile page) and they are read fresh, for this viewer.
 */
export async function loadStanding(supabase: SupabaseClient, authorIds: string[], opts: { now?: number; withFollows?: boolean } = {}): Promise<Map<string, Standing>> {
  const now = opts.now ?? Date.now();
  const out = new Map<string, Standing>();
  const ask: string[] = [];
  for (const id of new Set(authorIds)) {
    const hit = opts.withFollows ? undefined : memo.get(id);
    if (hit && now - hit.at < TTL_MS) out.set(id, hit.s); else ask.push(id);
  }
  if (ask.length === 0) return out;
  try {
    const { data, error } = await supabase.rpc("traveler_standing", { _authors: ask.slice(0, 60) });
    if (error) { console.error("[standing]", error.code, error.message); return out; }
    for (const r of (Array.isArray(data) ? data : []) as StandingRow[]) {
      if (!r?.author_id) continue;
      const s = toStanding(r);
      const shared: Standing = { ...s, followers: null, following: null };
      out.set(r.author_id, opts.withFollows ? s : shared);
      memo.set(r.author_id, { at: now, s: shared });
    }
    if (memo.size > MAX_ENTRIES) for (const k of [...memo.keys()].slice(0, memo.size - MAX_ENTRIES)) memo.delete(k);   // oldest first
  } catch (e) {
    console.error("[standing]", e instanceof Error ? e.message : e);
  }
  return out;
}
