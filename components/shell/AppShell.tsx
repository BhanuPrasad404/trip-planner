import type { ReactNode } from "react";
import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/server/trip-data";
import { tripState } from "@/lib/trip-state";
import { AppNav } from "./AppNav";
import { TimezoneCookie } from "./TimezoneCookie";
import type { NavTrip } from "./nav";

/** The persistent frame around every signed-in page: navigation + content area. */
export async function AppShell({ children }: { children: ReactNode }) {
  let trips: NavTrip[] = [];
  let initial = "?";
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      initial = (user.user_metadata?.display_name ?? user.email ?? "?").toString()[0]?.toUpperCase() ?? "?";
      const today = await todayISO();
      const { data } = await supabase.from("trips").select("id, name, start_date, num_days").order("created_at", { ascending: false }).limit(30);
      trips = (data ?? []).map((t) => ({ id: t.id as string, name: t.name as string, state: tripState(t as { start_date: string | null; num_days: number }, today) }));
    }
  } catch {
    /* navigation still renders; pages show their own errors */
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <TimezoneCookie />
      <AppNav trips={trips} userInitial={initial} signOutAction={signOut} />
      <div className="min-w-0 flex-1 pb-20 md:pb-0">{children}</div>
    </div>
  );
}
