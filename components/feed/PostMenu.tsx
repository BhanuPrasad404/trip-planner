"use client";

import { useEffect, useState } from "react";
import type { FeedItemDTO } from "@/lib/feed/map";
import { Sheet } from "./Sheet";
import { BlockIcon, EyeOffIcon, FlagIcon, HeartIcon, TrashIcon } from "./icons";

export type MenuResult = { message: string; remove: boolean; undo?: () => void };
type Reason = "spam" | "inappropriate" | "misinformation" | "misleading_place" | "harassment" | "unsafe" | "other";
const REASONS: [Reason, string][] = [
  ["misleading_place", "Wrong place or out of date"], ["misinformation", "False information"], ["spam", "Spam"],
  ["inappropriate", "Inappropriate"], ["harassment", "Harassment"], ["unsafe", "Unsafe or dangerous"], ["other", "Something else"],
];

async function call(url: string, method: string, body: unknown): Promise<void> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "That didn't work. Please try again.");
}

export function PostMenu({ item, onClose, onDone, onLikers }: { item: FeedItemDTO; onClose: () => void; onDone: (r: MenuResult) => void; onLikers: () => void }) {
  const [view, setView] = useState<"menu" | "report" | "delete">("menu");
  const [impact, setImpact] = useState<{ travelers: number; saves: number; helpful: number; tripAdds: number } | null>(null);
  useEffect(() => {
    if (!item.isMine) return;
    let live = true;
    fetch(`/api/posts/${item.id}/impact`).then((r) => (r.ok ? r.json() : null)).then((b) => { if (live && b) setImpact(b); }).catch(() => undefined);
    return () => { live = false; };
  }, [item.id, item.isMine]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<MenuResult>) {
    setBusy(true); setError(null);
    try { onDone(await fn()); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "That didn't work. Please try again."); setBusy(false); }
  }
  const hide = (kind: "post" | "destination" | "author", target: string, message: string) => run(async () => {
    await call("/api/feed/hide", "POST", { kind, target_id: target });
    return { message, remove: true, undo: () => void call("/api/feed/hide", "DELETE", { kind, target_id: target }).catch(() => undefined) };
  });

  const row = "flex min-h-14 w-full items-center gap-3 px-4 text-left text-base hover:bg-sky disabled:opacity-60";
  return (
    <Sheet title={view === "report" ? "Report this post" : view === "delete" ? "Delete this post?" : "More options"} onClose={onClose}>
      {error && <p role="alert" className="mx-4 mt-3 rounded-xl bg-clay-light px-3 py-2 text-sm text-clay-ink">{error}</p>}
      {item.isMine ? (
        view === "delete" ? (
          <div className="space-y-4 px-4 py-5">
            <p className="text-sm leading-relaxed text-ink-muted">This removes the {item.kind === "video" ? "video" : item.kind === "report" ? "report" : "photo"}, its comments and its likes for everyone. <strong className="text-pine">This can&apos;t be undone.</strong></p>
            <div className="flex flex-col gap-2.5">
              <button type="button" disabled={busy} onClick={() => void run(async () => {
                const res = await fetch(`/api/posts/${item.id}`, { method: "DELETE" });
                if (!res.ok && res.status !== 404) throw new Error((await res.json().catch(() => null))?.error ?? "Couldn't delete the post. Please try again.");   // already gone counts as done
                return { message: "Post deleted", remove: true };
              })} className="min-h-12 rounded-full bg-clay text-sm font-semibold text-white disabled:opacity-60">{busy ? "Deleting…" : "Delete post"}</button>
              <button type="button" disabled={busy} onClick={() => setView("menu")} className="min-h-12 rounded-full text-sm font-semibold text-pine hover:bg-sky">Keep it</button>
            </div>
          </div>
        ) : (
          <div className="py-2">
            <p className="mx-4 mb-1 mt-1 rounded-2xl bg-teal-light/60 px-3.5 py-3 text-sm text-pine" aria-live="polite">
              {impact === null ? "Checking how your post is doing…" : impact.travelers === 0 ? "No travelers have saved or used this post yet." : <><strong>Helped {impact.travelers} traveler{impact.travelers === 1 ? "" : "s"}.</strong> <span className="text-ink-muted">{[impact.saves ? `${impact.saves} saved` : null, impact.helpful ? `${impact.helpful} found it helpful` : null, impact.tripAdds ? `${impact.tripAdds} added it to a trip` : null].filter(Boolean).join(" · ")}</span></>}
            </p>
          <ul>
            <li><button type="button" className={row} onClick={() => { onClose(); onLikers(); }}><HeartIcon size={22} />See who liked this{item.counts.likes ? ` (${item.counts.likes})` : ""}</button></li>
            <li><button type="button" className={`${row} text-clay-ink`} onClick={() => setView("delete")}><TrashIcon size={22} />Delete post</button></li>
          </ul>
          </div>
        )
      ) : view === "menu" ? (
        <ul className="py-2">
          <li><button type="button" disabled={busy} className={row} onClick={() => void hide("destination", item.destination.id, `We'll show less from ${item.destination.name}`)}><EyeOffIcon size={22} />Not interested in {item.destination.name}</button></li>
          <li><button type="button" disabled={busy} className={row} onClick={() => void hide("post", item.id, "Post hidden")}><EyeOffIcon size={22} />Hide this post</button></li>
          <li><button type="button" disabled={busy} className={`${row} text-clay-ink`} onClick={() => setView("report")}><FlagIcon size={22} />Report</button></li>
          <li><button type="button" disabled={busy} className={`${row} text-clay-ink`} onClick={() => void run(async () => {
            await call("/api/users/block", "POST", { username: item.author.username });
            return { message: `Blocked @${item.author.username}`, remove: true, undo: () => void call("/api/users/block", "DELETE", { username: item.author.username }).catch(() => undefined) };
          })}><BlockIcon size={22} />Block @{item.author.username}</button></li>
        </ul>
      ) : (
        <ul className="py-2">
          {REASONS.map(([reason, label]) => (
            <li key={reason}><button type="button" disabled={busy} className={row} onClick={() => void run(async () => {
              await call(`/api/posts/${item.id}/report`, "POST", { reason });
              return { message: "Thanks — we'll take a look", remove: true };
            })}>{label}</button></li>
          ))}
          <li><button type="button" className={`${row} text-ink-muted`} onClick={() => setView("menu")}>Back</button></li>
        </ul>
      )}
    </Sheet>
  );
}
