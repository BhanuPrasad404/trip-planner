"use client";

import { Spinner } from "@/components/ui/Spinner";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FeedItemDTO } from "@/lib/feed/map";
import { Avatar } from "./Avatar";
import { SendIcon } from "./icons";

export type Comment = { id: string; parentId: string | null; body: string; createdAt: string; author: { username: string; displayName: string | null } };

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** The comments of one post and the box to add one. Lives inside a sheet (the feed) or on the page (the post page). */
export function CommentsPanel({ item, onPosted, inputId = "comment-input" }: { item: Pick<FeedItemDTO, "id" | "canComment">; onPosted: () => void; inputId?: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [moreBusy, setMoreBusy] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<{ message: string; needsProfile?: boolean } | null>(null);
  const fetchPage = useCallback(async (cur: string | null): Promise<{ comments: Comment[]; nextCursor: string | null }> => {
    const res = await fetch(`/api/posts/${item.id}/comments${cur ? `?cursor=${encodeURIComponent(cur)}` : ""}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error ?? "Couldn't load comments.");
    return body;
  }, [item.id]);

  useEffect(() => {
    let live = true;
    fetchPage(null)
      .then((b) => { if (live) { setComments(b.comments); setCursor(b.nextCursor); setState("ready"); } })
      .catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [fetchPage]);

  function retry() {
    setState("loading");
    fetchPage(null).then((b) => { setComments(b.comments); setCursor(b.nextCursor); setState("ready"); }).catch(() => setState("error"));
  }
  function more() {
    if (!cursor || moreBusy) return;
    setMoreBusy(true); setProblem(null);
    fetchPage(cursor)
      .then((b) => { setComments((c) => [...c, ...b.comments]); setCursor(b.nextCursor); })
      .catch((e) => setProblem({ message: e instanceof Error ? e.message : "Couldn't load more." }))
      .finally(() => setMoreBusy(false));
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setProblem(null);
    try {
      const res = await fetch(`/api/posts/${item.id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
      const j = await res.json().catch(() => null);
      if (res.status === 409) { setProblem({ message: "Set up your traveler profile to comment.", needsProfile: true }); return; }
      if (!res.ok) throw new Error(j?.error ?? "Couldn't post your comment.");
      setComments((c) => [...c, { ...j.comment, author: { username: "you", displayName: null } }]);
      setText(""); onPosted();
    } catch (e) {
      setProblem({ message: e instanceof Error ? e.message : "Couldn't post your comment. Check your connection." });   // the text stays so nothing is lost
    } finally { setSending(false); }
  }

  return (
    <div className="flex flex-col">
      <ul className="space-y-4 px-4 py-4" aria-live="polite">
        {state === "loading" && [0, 1, 2].map((i) => <li key={i} className="h-10 animate-pulse rounded-xl bg-sky" />)}
        {state === "error" && <li className="text-sm text-clay-ink">Couldn&apos;t load comments. <button type="button" onClick={retry} className="font-semibold underline">Try again</button></li>}
        {state === "ready" && comments.length === 0 && <li className="py-6 text-center text-sm text-ink-muted">No comments yet. Ask about the road, the crowd, the best time to go.</li>}
        {comments.map((c) => (
          <li key={c.id} className={`flex gap-2.5 ${c.parentId ? "ml-8" : ""}`}>
            <Avatar username={c.author.username} displayName={c.author.displayName} size={28} />
            <div className="min-w-0">
              <p className="text-sm"><strong className="font-semibold text-pine">@{c.author.username}</strong> <span className="break-words text-ink">{c.body}</span></p>
              <p className="text-xs text-ink-muted">{when(c.createdAt)}</p>
            </div>
          </li>
        ))}
        {cursor && <li><button type="button" disabled={moreBusy} onClick={more} className="min-h-11 text-sm font-semibold text-teal-ink underline disabled:opacity-60">{moreBusy ? "Loading…" : "Show more comments"}</button></li>}
      </ul>
      <div className="border-t border-line p-3">
        {problem && <p role="alert" className="mb-2 text-sm text-clay-ink">{problem.message} {problem.needsProfile && <Link href="/profile" className="font-semibold underline">Open profile</Link>}</p>}
        {item.canComment ? (
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor={inputId}>Add a comment</label>
            <textarea id={inputId} value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={500} placeholder="Add a comment…"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-white px-3.5 py-2.5 text-base text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/40" />
            <button type="button" onClick={() => void send()} disabled={sending || !text.trim()} aria-label="Post comment"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal text-white disabled:opacity-50">{sending ? <Spinner size={18} /> : <SendIcon size={20} />}</button>
          </div>
        ) : <p className="text-center text-sm text-ink-muted">Comments are turned off for this post.</p>}
      </div>
    </div>
  );
}
