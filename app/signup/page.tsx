import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { SiteHeader } from "@/components/SiteHeader";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <AuthForm
          mode="signup"
          next={safeNextPath(next)}
          initialError={error ? "We couldn't verify that link. Please try again." : null}
        />
      </main>
    </>
  );
}
