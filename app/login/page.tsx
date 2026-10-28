import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { SiteHeader } from "@/components/SiteHeader";
import { StaleSessionCleaner } from "@/components/StaleSessionCleaner";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; deleted?: string; session?: string }>;
}) {
  const { next, error, deleted, session } = await searchParams;
  const ended = session === "ended";
  return (
    <>
      <SiteHeader />
      {ended && <StaleSessionCleaner />}
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <AuthForm
          mode="login"
          next={safeNextPath(next)}
          initialError={error ? "We couldn't verify that link. Please try again." : null}
          initialNotice={deleted ? "Your account and data have been deleted. Thank you for trying Trailmate." : ended ? "Your session ended. Please log in again." : null}
        />
      </main>
    </>
  );
}
