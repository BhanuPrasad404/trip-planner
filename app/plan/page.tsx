import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { PlanFlow } from "@/components/plan/PlanFlow";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Plan a trip", description: "Turn the places you saw into a real trip: paste, describe or pick them, in your language." };

// The guided trip-creation flow. Open to everyone: a guest can try it all, and signs up only to save the trip.
export default async function PlanPage() {
  let signedIn = false;
  try { signedIn = !!(await (await createClient()).auth.getUser()).data.user; } catch { /* auth unreachable: treat as a guest */ }
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <PlanFlow signedIn={signedIn} />
      </main>
    </>
  );
}
