import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { SiteHeader } from "@/components/SiteHeader";
import { RESET_EXPIRED_MESSAGE } from "@/lib/password-reset";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false } };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <ForgotPasswordForm initialError={expired ? RESET_EXPIRED_MESSAGE : null} />
      </main>
    </>
  );
}
