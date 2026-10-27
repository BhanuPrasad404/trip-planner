import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { PostDetail } from "@/components/feed/PostDetail";
import { postIdSchema } from "@/lib/feed/schemas";
import { loadDiscoverTrips } from "@/lib/server/discover-context";
import { loadPlaceMore, loadPost } from "@/lib/server/feed-service";
import { createClient } from "@/lib/supabase/server";

// One post on its own address, so it can be shared, opened later and come back to from the feed. The post is read ONCE per request
// (the title and the page share it) and only under the viewer's own rules: a deleted, blocked or hidden post is simply not found.
const read = cache(async (rawId: string) => {
  const id = postIdSchema.safeParse(rawId);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !id.success) return { supabase, user, id: id.success ? id.data : null, item: null };
  const item = await loadPost(supabase, user.id, id.data);
  return { supabase, user, id: id.data, item };
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { item } = await read((await params).id);
  if (!item) return { title: "Post", robots: { index: false, follow: false } };
  const spot = item.placeName.toLowerCase() === item.destination.name.toLowerCase() ? "" : `, ${item.placeName}`;
  return { title: `${item.destination.name}${spot}`, description: item.caption ?? `What travelers say it is like at ${item.destination.name}.`, robots: { index: false, follow: false } };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const rawId = (await params).id;
  const { supabase, user, item } = await read(rawId);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/discover/${rawId}`)}`);
  if (!item) notFound();
  const [more, { trips, focusId }, { data: profile }] = await Promise.all([
    loadPlaceMore(supabase, user.id, item.destination.id, item.id),
    loadDiscoverTrips(supabase),
    supabase.from("profiles").select("id").eq("id", user.id).maybeSingle(),
  ]);
  return (
    <main id="main">
      <PostDetail initial={item} more={more} trips={trips.map((t) => ({ id: t.id, name: t.name }))} focusTripId={focusId} hasProfile={!!profile} />
    </main>
  );
}
