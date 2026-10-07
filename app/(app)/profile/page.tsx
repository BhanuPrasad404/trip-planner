import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { SetupCheck } from "@/components/SetupCheck";
import { TravelerProfileForm } from "@/components/TravelerProfileForm";
import { TravelStyleClient } from "@/components/TravelStyleClient";
import { Button } from "@/components/ui/Button";
import { signOut } from "@/app/actions/auth";
import { requireUser } from "@/lib/auth";
import { getSetupStatus } from "@/lib/config";
import { loadLearnTrips } from "@/lib/server/learning-data";

export const metadata: Metadata = { title: "Profile", robots: { index: false } };

export default async function ProfilePage() {
  const { supabase, user } = await requireUser("/profile");
  const trips = await loadLearnTrips(supabase);
  const setup = getSetupStatus();
  const { data: profile } = await supabase.from("profiles").select("username, display_name, bio, interests, is_private, show_follow_lists").eq("id", user.id).maybeSingle();

  return (
    <main id="main" className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader eyebrow="You" title="Profile" subtitle={user.email ?? undefined} actions={<form action={signOut}><Button type="submit" variant="secondary" size="sm">Sign out</Button></form>} />

      <TravelerProfileForm initial={profile ?? null} />

      <TravelStyleClient trips={trips} />

      <section aria-labelledby="privacy-heading" className="rounded-2xl border border-line bg-white p-5">
        <h2 id="privacy-heading" className="font-display text-lg font-semibold text-pine">Your location & privacy</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>Your location is used only while you press <strong>Start drive</strong> or run a nearby search, and only to work out what is ahead of you.</li>
          <li>We <strong>don&apos;t keep a history</strong> of where you have been. Searches use your position once and don&apos;t store it.</li>
          <li>Sharing with your group is <strong>opt-in</strong> each drive. Stopping the drive deletes your live position; forgotten shares disappear after 6 hours.</li>
          <li>Other people see a dot on the map, never an exact history. Community photo updates on stops never show who posted them. Posts with a traveler profile show your username only if you choose to create one.</li>
          <li>You can switch location off in your browser at any time — Trailmate still works for planning, and Google Maps links keep working.</li>
        </ul>
      </section>

      <SetupCheck items={setup} />
    </main>
  );
}
