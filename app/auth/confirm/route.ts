import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { RESET_PATH } from "@/lib/password-reset";

// Landing point for email links that carry a token_hash (Supabase email templates).
// Verified on the server, so the link works on any device — not only in the browser that asked for it.
const TYPES: readonly EmailOtpType[] = ["recovery", "signup", "email", "invite", "magiclink", "email_change"];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const type = TYPES.find((t) => t === rawType);
  const isRecovery = type === "recovery";
  // A reset link always lands on the reset page, whatever ?next= says.
  const next = isRecovery ? RESET_PATH : safeNextPath(searchParams.get("next"));

  if (tokenHash && type) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (!error) return NextResponse.redirect(`${origin}${next}`);
    } catch {
      // fall through to the friendly error page
    }
  }
  return NextResponse.redirect(isRecovery ? `${origin}/forgot-password?expired=1` : `${origin}/login?error=auth`);
}
