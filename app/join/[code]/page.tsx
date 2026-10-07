import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { LinkButton } from "@/components/ui/Button";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Join trip", robots: { index: false, follow: false } };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { supabase } = await requireUser(`/join/${code}`);

  let tripId: string | null = null;
  if (/^[a-zA-Z0-9]{6,32}$/.test(code)) {
    const { data, error } = await supabase.rpc("join_trip_by_code", { _code: code });
    if (!error && typeof data === "string") tripId = data;
  }

  // redirect() works by throwing, so it must stay outside any try/catch.
  if (tripId) redirect(`/trips/${tripId}`);

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-line bg-white p-8 text-center shadow-sm">
          <h1 className="font-display text-2xl font-semibold text-pine">This invite link doesn&apos;t work</h1>
          <p className="mt-3 text-base text-ink-muted">
            It may have been mistyped or replaced. Ask the trip owner to send you a fresh link.
          </p>
          <LinkButton href="/trips" className="mt-6">
            Go to my trips
          </LinkButton>
        </div>
      </main>
    </>
  );
}
