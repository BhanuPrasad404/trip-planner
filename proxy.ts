import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16: `middleware.ts` was renamed to `proxy.ts`.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static assets and image files; everything else gets a session refresh.
  // Also skipped: the connectivity probe (/api/ping must stay instant and work with no sign-in), the service worker and its offline page,
  // and the installable-app files (manifest + icons): public, identical for everyone, never touched by a session.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/ping$|sw\\.js$|offline\\.html$|manifest\\.webmanifest$|pwa-icon/|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)"],
};
