// Session refresh + optimistic route protection, called from /proxy.ts.
// This is a UX convenience, NOT the security boundary — real authorization is
// enforced by Postgres Row Level Security and by server-side checks in pages/routes.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";

const PROTECTED_PREFIXES = ["/trips", "/trip", "/join"];
const AUTH_PAGES = ["/login", "/signup"];

const matches = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname, search } = request.nextUrl;

  let signedIn = false;
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
  } catch (err) {
    console.error("[proxy] session check failed:", err instanceof Error ? err.message : err);
  }

  if (!signedIn && matches(pathname, PROTECTED_PREFIXES)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(loginUrl);
  }

  if (signedIn && matches(pathname, AUTH_PAGES)) {
    const tripsUrl = request.nextUrl.clone();
    tripsUrl.pathname = "/trips";
    tripsUrl.search = "";
    return NextResponse.redirect(tripsUrl);
  }

  return response;
}
