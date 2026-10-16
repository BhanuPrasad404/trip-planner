import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { WelcomeForm } from "@/components/WelcomeForm";
import { needsConsent, suggestedName } from "@/lib/oauth";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Welcome", robots: { index: false } };

// The one-time step for people who signed in with Google: agree to the Terms, and confirm the name the group sees.
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext);
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!needsConsent(user)) redirect(next); // already agreed (or an email account): nothing to do here
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <WelcomeForm next={next} initialName={suggestedName(user.user_metadata)} email={user.email ?? null} />
      </main>
    </>
  );
}
