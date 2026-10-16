import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { RESET_PATH } from "@/lib/password-reset";
import { needsConsent, welcomeUrl } from "@/lib/oauth";

// Landing point for Supabase email links (confirmation, password reset): swaps the one-time code for a session.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    // First time through Google: agree to the Terms (and confirm the name the group sees) before anything else.
    if (!error) return NextResponse.redirect(`${origin}${needsConsent(data?.user) ? welcomeUrl(next) : next}`);
  }
  // A failed reset link gets the "request a new link" page, not the generic login error.
  if (next === RESET_PATH) return NextResponse.redirect(`${origin}/forgot-password?expired=1`);
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
