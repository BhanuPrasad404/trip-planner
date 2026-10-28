// Session refresh + optimistic route protection, called from /proxy.ts.
// This is a UX convenience, NOT the security boundary — real authorization is
// enforced by Postgres Row Level Security and by server-side checks in pages/routes.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";
import { WELCOME_PATH, consentFree, needsConsent } from "@/lib/oauth";

// Every page that needs a signed-in person. Stopping them HERE (before the page starts streaming) matters: a page that redirects after it has
// started sending can only do it from the browser, which React reports as "could not finish this Suspense boundary" and the screen flickers.
const PROTECTED_PREFIXES = ["/trips", "/trip", "/join", "/dashboard", "/discover", "/explore", "/memories", "/profile"];
// /reset-password is deliberately NOT here: the reset link signs the person in before they choose the new password.
const AUTH_PAGES = ["/login", "/signup", "/forgot-password"];

const matches = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname, search } = request.nextUrl;

  let signedIn = false;
  let mustAgree = false;
  try {
    const { url, anonKey } = getSupabaseEnv();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });
    // getClaims() verifies the JWT locally (no Auth-server round trip on every request).
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
    mustAgree = signedIn && needsConsent(data?.claims);
  } catch (err) {
    console.error("[proxy] session check failed:", err instanceof Error ? err.message : err);
  }

  if (!signedIn && matches(pathname, PROTECTED_PREFIXES)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(loginUrl);
  }

  // Signed in through Google but never agreed to the Terms: the one-time welcome step first (pages only; data stays protected by RLS).
  if (mustAgree && !pathname.startsWith("/api/") && !consentFree(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = WELCOME_PATH;
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // `session=ended`: a page asked the Auth server and it said this session is gone, although the token still looks valid here. Let the login
  // page open (it clears the stale cookie) instead of bouncing the visitor back to the app, which would send them straight back here.
  const sessionEnded = request.nextUrl.searchParams.get("session") === "ended";
  if (signedIn && !sessionEnded && matches(pathname, AUTH_PAGES)) {
    const tripsUrl = request.nextUrl.clone();
    tripsUrl.pathname = "/trips";
    tripsUrl.search = "";
    return NextResponse.redirect(tripsUrl);
  }

  return response;
}
