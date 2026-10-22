import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { PollForm } from "@/components/plan/PollForm";

export const metadata: Metadata = { title: "Help plan the trip", robots: { index: false } };

// A friend's answer page for "Ask your group" — open to everyone, no sign-up.
export default async function PollPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 pb-16 pt-4">
        <PollForm code={code} />
      </main>
    </>
  );
}
