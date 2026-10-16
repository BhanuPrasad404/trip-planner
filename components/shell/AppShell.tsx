import type { ReactNode } from "react";
import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/server/trip-data";
import { tripState } from "@/lib/trip-state";
import { AppNav } from "./AppNav";
import { OfflineBanner } from "@/components/OfflineBanner";
import { TimezoneCookie } from "./TimezoneCookie";
import { ServiceWorker } from "./ServiceWorker";
import type { NavTrip } from "./nav";

/** The persistent frame around every signed-in page: navigation + content area. */
export async function AppShell({ children }: { children: ReactNode }) {
  let trips: NavTrip[] = [];
  let initial = "?";
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    // The sign-in check and the trips list go out together (they used to be two round trips in a row on every full page load).
    // Without a signed-in user the list is simply not used; Row Level Security decides what the list can contain.
    const [auth, list, today] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("trips").select("id, name, start_date, num_days").order("created_at", { ascending: false }).limit(30),
      todayISO(),
    ]);
    const user = auth.data.user;
    if (user) {
      userId = user.id;
      initial = (user.user_metadata?.display_name ?? user.email ?? "?").toString()[0]?.toUpperCase() ?? "?";
      trips = (list.data ?? []).map((t) => ({ id: t.id as string, name: t.name as string, state: tripState(t as { start_date: string | null; num_days: number }, today) }));
    }
  } catch {
    /* navigation still renders; pages show their own errors */
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <TimezoneCookie />
      <ServiceWorker />
      <AppNav trips={trips} userInitial={initial} signOutAction={signOut} userId={userId} />
      <div className="min-w-0 flex-1 pb-28 md:pb-0">
        <OfflineBanner />
        {children}
      </div>
    </div>
  );
}
