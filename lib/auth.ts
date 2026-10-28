import { redirect } from "next/navigation";
import type { AuthError, SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * The sign-in service could not be reached (a network hiccup, a timeout, a 5xx). This is NOT "you are signed out": sending the person to
 * the login page for it made a loop. The proxy believes the (locally checked) token and bounces a signed-in visitor off /login, the page
 * asks the Auth server, gets no answer, and redirects to /login again: the screen blinks for ever. Now the page shows its error screen
 * with a Try again button instead.
 */
export class AuthUnavailableError extends Error {
  constructor() {
    super("The sign-in service could not be reached");
    this.name = "AuthUnavailableError";
  }
}

export type AuthVerdict = "ok" | "signed_out" | "session_ended" | "unavailable";

/** What Supabase's answer to getUser() means. Pure, so every case is tested. */
export function judgeAuth(r: { data: { user: User | null }; error: Pick<AuthError, "name" | "status"> | null }): AuthVerdict {
  if (r.data.user) return "ok";
  const e = r.error;
  if (!e || e.name === "AuthSessionMissingError") return "signed_out";          // no session at all: a normal visitor who isn't signed in
  const s = e.status;
  if (e.name === "AuthRetryableFetchError" || s === undefined || s === 0 || s >= 500) return "unavailable";
  if (s === 400 || s === 401 || s === 403 || s === 404 || s === 422) return "session_ended"; // the server answered: this session is gone or invalid
  return "unavailable";                                                         // 429 and anything else odd: don't guess, don't loop
}

/** Where a person goes to sign in again. `session=ended` tells the proxy and the login page the old cookie is stale (see lib/supabase/proxy.ts). */
export const loginPath = (nextPath: string, sessionEnded = false) => `/login?next=${encodeURIComponent(nextPath)}${sessionEnded ? "&session=ended" : ""}`;

function gate(verdict: AuthVerdict, nextPath: string): void {
  if (verdict === "unavailable") throw new AuthUnavailableError();
  if (verdict !== "ok") redirect(loginPath(nextPath, verdict === "session_ended"));
}

/** Server-side auth gate for pages. Authoritative (validates with the Auth server). */
export async function requireUser(nextPath: string) {
  const supabase = await createClient();
  let r: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try { r = await supabase.auth.getUser(); } catch { throw new AuthUnavailableError(); }   // the call itself failed (no network): same as "can't reach it"
  gate(judgeAuth(r), nextPath);
  return { supabase, user: r.data.user as User };
}

/**
 * The same gate, but the page's own data requests start AT THE SAME TIME as the Auth check instead of after it — one network
 * round trip saved on every page load (each is ~100–200 ms between a server and the database in another region).
 *
 * Nothing is weakened: the Auth server still validates the session, and if it says "no user" the person is redirected and
 * whatever was loaded is thrown away, never rendered. The data requests carry the person's own token, so Row Level Security —
 * the real boundary — decides what they may read exactly as before. A loader that fails for an unsigned-in visitor is
 * ignored in favour of the redirect; for a signed-in person its error is raised as usual.
 */
export async function requireUserAnd<T>(nextPath: string, load: (supabase: SupabaseClient) => Promise<T>): Promise<{ supabase: SupabaseClient; user: User; loaded: T }> {
  const supabase = await createClient();
  const [auth, data] = await Promise.allSettled([supabase.auth.getUser(), load(supabase)]);
  if (auth.status === "rejected") throw new AuthUnavailableError();
  gate(judgeAuth(auth.value), nextPath);
  if (data.status === "rejected") throw data.reason;
  return { supabase, user: auth.value.data.user as User, loaded: data.value };
}
