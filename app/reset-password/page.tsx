import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { SiteHeader } from "@/components/SiteHeader";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set a new password", robots: { index: false } };

// The reset link (via /auth/confirm or /auth/callback) signs the person in before landing here.
// No session = the link was expired, already used, or opened without going through the email.
export default async function ResetPasswordPage() {
  let hasSession = false;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    hasSession = Boolean(data.user);
  } catch {
    hasSession = false;
  }
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <ResetPasswordForm hasSession={hasSession} />
      </main>
    </>
  );
}
