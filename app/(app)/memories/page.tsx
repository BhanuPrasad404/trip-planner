import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { TripCard } from "@/components/TripCard";
import { requireUser } from "@/lib/auth";
import { summarizeTrips } from "@/lib/server/trip-summaries";
import { todayISO } from "@/lib/server/trip-data";
import type { Trip } from "@/lib/types";

export const metadata: Metadata = { title: "Memories", robots: { index: false } };

export default async function MemoriesPage() {
  const { supabase, user } = await requireUser("/memories");
  const { data } = await supabase.from("trips").select("*").order("start_date", { ascending: false }).limit(60);
  const all = await summarizeTrips(supabase, (data ?? []) as Trip[], await todayISO());
  const past = all.filter((t) => t.state === "completed");
  const totalDone = past.reduce((s, t) => s + t.done, 0);

  return (
    <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader eyebrow="Look back" title="Memories" subtitle={past.length > 0 ? `${past.length} finished trip${past.length === 1 ? "" : "s"} · ${totalDone} stops you actually visited.` : "Finished trips live here, with what you planned and what really happened."} />
      {past.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-teal/40 bg-white/60 p-8 text-center">
          <p className="font-display text-xl font-semibold text-pine">No finished trips yet</p>
          <p className="mx-auto mt-2 max-w-md text-ink-muted">When a trip ends, its story — stops visited, plan vs reality and your photos — appears here. Nothing is made up: only what you did in the app.</p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{past.map((t) => <TripCard key={t.id} trip={t} isOwner={t.owner_id === user.id} />)}</ul>
      )}
    </main>
  );
}
