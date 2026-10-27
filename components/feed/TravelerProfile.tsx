"use client";

import Link from "next/link";
import { useState } from "react";
import type { FeedItemDTO } from "@/lib/feed/map";
import { compact } from "@/lib/feed/people";
import type { Standing } from "@/lib/social/standing";
import { Avatar } from "./Avatar";
import { BackIcon } from "./icons";
import { PostGrid } from "./PostGrid";
import { StandingCard } from "./TravelerBadge";

export type FollowState = "none" | "pending" | "following";
export type ProfileView = { username: string; displayName: string | null; bio: string | null; isPrivate: boolean; mine: boolean };

/** Follow / Following / Requested. Instant on screen; the server's answer wins; a failure puts it back with the reason. */
export function FollowButton({ username, initial, onChange, compact = false, onError }: {
  username: string; initial: FollowState; onChange?: (s: FollowState) => void;
  /** Small chip for a card header; its problems go to `onError` (a toast) instead of a line under it. */
  compact?: boolean; onError?: (text: string, link?: { label: string; href: string }) => void;
}) {
  const [state, setState] = useState<FollowState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; profile?: boolean } | null>(null);
  async function toggle() {
    if (busy) return;
    const before = state;
    const following = state !== "none";
    setBusy(true); setError(null);
    setState(following ? "none" : "following"); onChange?.(following ? "none" : "following");
    try {
      const res = following
        ? await fetch(`/api/follows?username=${encodeURIComponent(username)}`, { method: "DELETE" })
        : await fetch("/api/follows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
      const body = await res.json().catch(() => null);
      if (res.status === 409) {
        if (onError) onError("Set up your traveler profile to follow people.", { label: "Open profile", href: "/profile" });
        else setError({ text: "Set up your traveler profile to follow people.", profile: true });
        throw new Error("profile");
      }
      if (!res.ok) throw new Error(body?.error ?? "That didn't work. Please try again.");
      if (!following && body?.status === "pending") { setState("pending"); onChange?.("pending"); }
    } catch (e) {
      setState(before); onChange?.(before);
      if (!(e instanceof Error && e.message === "profile")) {
        const text = e instanceof Error && e.message !== "Failed to fetch" ? e.message : "No connection. Please try again.";
        if (onError) onError(text); else setError({ text });
      }
    } finally { setBusy(false); }
  }
  const label = state === "following" ? "Following" : state === "pending" ? "Requested" : "Follow";
  if (compact) {
    return (
      <button type="button" onClick={() => void toggle()} disabled={busy} aria-pressed={state !== "none"}
        className={`min-h-9 shrink-0 rounded-full px-3.5 text-xs font-semibold transition-transform active:scale-95 disabled:opacity-70 motion-reduce:transition-none ${state === "none" ? "bg-teal text-white" : "border border-line text-ink"}`}>
        {label}<span className="sr-only">{state === "none" ? ` @${username}` : ` @${username} (tap to ${state === "pending" ? "cancel the request" : "unfollow"})`}</span>
      </button>
    );
  }
  return (
    <div>
      <button type="button" onClick={() => void toggle()} disabled={busy} aria-pressed={state !== "none"}
        className={`min-h-11 min-w-28 rounded-full px-5 text-sm font-semibold transition-transform active:scale-95 disabled:opacity-70 motion-reduce:transition-none ${state === "none" ? "bg-teal text-white" : "border border-line text-pine hover:bg-sky"}`}>
        {label}<span className="sr-only">{state === "none" ? ` @${username}` : ` (tap to ${state === "pending" ? "cancel the request" : "unfollow"})`}</span>
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-clay-ink">{error.text} {error.profile && <Link href="/profile" className="font-semibold underline">Open profile</Link>}</p>}
    </div>
  );
}

function Count({ n, label }: { n: number | null; label: string }) {
  if (n == null) return null;
  return <li className="min-w-0 text-center"><span className="block font-display text-xl font-semibold tabular-nums text-pine">{compact(n)}</span><span className="block text-xs text-ink-muted">{label}</span></li>;
}

export function TravelerProfile({ profile, standing, follow, posts: initial, nextCursor: initialCursor, postsHidden }: { profile: ProfileView; standing: Standing; follow: FollowState; posts: FeedItemDTO[]; nextCursor: string | null; postsHidden: boolean }) {
  const [posts, setPosts] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [followers, setFollowers] = useState(standing.followers);
  const [followState, setFollowState] = useState(follow);

  async function more() {
    if (!cursor || busy) return;
    setBusy(true); setProblem(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(profile.username)}/posts?cursor=${encodeURIComponent(cursor)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load more.");
      const have = new Set(posts.map((p) => p.id));
      setPosts((p) => [...p, ...(body.items as FeedItemDTO[]).filter((i) => !have.has(i.id))]);
      setCursor(body.nextCursor);
    } catch (e) { setProblem(e instanceof Error ? e.message : "Couldn't load more."); }
    finally { setBusy(false); }
  }
  const onFollow = (s: FollowState) => {
    if (followers == null) { setFollowState(s); return; }
    const was = followState === "following", now = s === "following";
    if (was !== now) setFollowers((n) => Math.max(0, (n ?? 0) + (now ? 1 : -1)));
    setFollowState(s);
  };

  return (
    <div className="mx-auto w-full max-w-2xl pb-8 sm:px-5">
      <div className="px-2 py-2 sm:px-0 sm:py-4">
        <Link href="/discover" className="inline-flex min-h-11 items-center gap-1 rounded-full pl-1 pr-3 text-sm font-semibold text-pine hover:bg-sky"><BackIcon size={22} />Discover</Link>
      </div>
      <header className="flex flex-wrap items-start gap-4 px-4 sm:px-0">
        <Avatar username={profile.username} displayName={profile.displayName} size={72} />
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="break-words font-display text-3xl font-semibold leading-tight text-pine">{profile.displayName ?? `@${profile.username}`}</h1>
          {profile.displayName && <p className="text-sm text-ink-muted">@{profile.username}</p>}
          {profile.bio && <p className="mt-2 whitespace-pre-line break-words text-sm text-ink">{profile.bio}</p>}
        </div>
        {profile.mine
          ? <Link href="/profile" className="inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-semibold text-pine hover:bg-sky">Edit profile</Link>
          : <FollowButton username={profile.username} initial={follow} onChange={onFollow} />}
      </header>

      <ul className="mt-5 grid grid-cols-4 gap-2 px-4 sm:px-0" aria-label="Numbers">
        <Count n={standing.posts} label={standing.posts === 1 ? "post" : "posts"} />
        <Count n={standing.helped} label="helped" />
        <Count n={followers} label={followers === 1 ? "follower" : "followers"} />
        <Count n={standing.following} label="following" />
      </ul>

      <div className="mt-5 px-4 sm:px-0"><StandingCard helped={standing.helped} tier={standing.tier} place={standing.place} mine={profile.mine} /></div>

      <section aria-labelledby="their-posts" className="mt-6">
        <h2 id="their-posts" className="mb-3 px-4 font-display text-xl font-semibold text-pine sm:px-0">{profile.mine ? "Your posts" : "Posts"}</h2>
        {postsHidden ? (
          <p className="mx-4 rounded-2xl bg-sky p-4 text-sm text-ink-muted sm:mx-0">This traveler shares posts with followers only. {followState === "pending" ? "Your request is waiting for their answer." : "Follow them to ask."}</p>
        ) : posts.length === 0 ? (
          <p className="mx-4 rounded-2xl bg-sky p-4 text-sm text-ink-muted sm:mx-0">{profile.mine ? "You haven't shared anything yet. Your first post could help someone pick the right day." : "No posts yet."}</p>
        ) : (
          <>
            <PostGrid items={posts} layout="grid" />
            {problem && <p role="alert" className="mt-3 px-4 text-sm text-clay-ink sm:px-0">{problem}</p>}
            {cursor && <div className="mt-4 flex justify-center"><button type="button" onClick={() => void more()} disabled={busy} className="min-h-11 rounded-full border border-line px-6 text-sm font-semibold text-pine hover:bg-sky disabled:opacity-60">{busy ? "Loading…" : "Show more"}</button></div>}
          </>
        )}
      </section>
    </div>
  );
}
