import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TravelerProfile, type FollowState } from "@/components/feed/TravelerProfile";
import { requireUser } from "@/lib/auth";
import { blockSchema } from "@/lib/feed/schemas";
import { loadAuthorPosts } from "@/lib/server/feed-service";
import { loadStanding } from "@/lib/server/standing";

export const metadata: Metadata = { title: "Traveler", robots: { index: false, follow: false } };

// A traveler's own page: who they are, the badge they earned by helping others, and their posts. Everything is read under the
// viewer's own rules: a private traveler's posts only for followers, blocked people not at all.
export default async function TravelerPage({ params }: { params: Promise<{ username: string }> }) {
  const raw = (await params).username;
  const { supabase, user } = await requireUser(`/discover/u/${encodeURIComponent(raw)}`);
  const name = blockSchema.safeParse({ username: decodeURIComponent(raw) });
  if (!name.success) notFound();
  const { data: p } = await supabase.from("profiles").select("id, username, display_name, bio, is_private").eq("username", name.data.username).maybeSingle();
  if (!p) notFound();
  const profile = p as { id: string; username: string; display_name: string | null; bio: string | null; is_private: boolean };
  const mine = profile.id === user.id;

  const [standingMap, follow, page] = await Promise.all([
    loadStanding(supabase, [profile.id], { withFollows: true }),
    mine ? Promise.resolve({ data: null }) : supabase.from("follows").select("status").eq("follower_id", user.id).eq("followee_id", profile.id).maybeSingle(),
    loadAuthorPosts(supabase, user.id, profile.id, null).catch(() => ({ items: [], nextCursor: null })),
  ]);
  const standing = standingMap.get(profile.id) ?? { helped: 0, posts: 0, followers: null, following: null, tier: null, place: null };
  const status = (follow.data as { status?: string } | null)?.status;
  const followState: FollowState = status === "accepted" ? "following" : status === "pending" ? "pending" : "none";
  // A private traveler's posts are visible only to accepted followers (the database enforces it; this only explains an empty list).
  const postsHidden = !mine && profile.is_private && followState !== "following" && page.items.length === 0 && standing.posts > 0;

  return (
    <main id="main">
      <TravelerProfile
        profile={{ username: profile.username, displayName: profile.display_name, bio: profile.bio, isPrivate: profile.is_private, mine }}
        standing={standing} follow={followState} posts={page.items} nextCursor={page.nextCursor} postsHidden={postsHidden}
      />
    </main>
  );
}
