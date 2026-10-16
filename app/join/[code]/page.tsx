import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { LinkButton } from "@/components/ui/Button";
import { requireUser } from "@/lib/auth";
import { joinWithInvite, type JoinStatus } from "@/lib/server/invites";

export const metadata: Metadata = { title: "Join trip", robots: { index: false, follow: false } };

const MESSAGES: Record<Exclude<JoinStatus, "joined" | "already_member">, { title: string; body: string }> = {
  invalid: { title: "This invite link doesn't work", body: "It may have been mistyped, or the owner made a new link and this one was replaced. Ask the trip owner to send you the current link." },
  expired: { title: "This invite link has expired", body: "The owner set it to stop working after a while. Ask them to send you a new link." },
  too_many_attempts: { title: "Too many attempts", body: "For safety, joining is paused after several links that didn't work. Please wait an hour, then open the link the owner sent you." },
  error: { title: "We couldn't open this invite", body: "Something went wrong on our side. Please try the link again in a minute." },
};

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { supabase } = await requireUser(`/join/${code}`);
  const { status, tripId } = await joinWithInvite(supabase, code);

  // redirect() works by throwing, so it must stay outside any try/catch.
  if ((status === "joined" || status === "already_member") && tripId) redirect(`/trips/${tripId}`);
  const msg = MESSAGES[status === "joined" || status === "already_member" ? "error" : status];

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-line bg-white p-8 text-center shadow-sm">
          <h1 className="font-display text-2xl font-semibold text-pine">{msg.title}</h1>
          <p className="mt-3 text-base text-ink-muted">{msg.body}</p>
          <LinkButton href="/trips" className="mt-6">
            Go to my trips
          </LinkButton>
        </div>
      </main>
    </>
  );
}
