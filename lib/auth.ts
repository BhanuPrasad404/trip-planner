import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** Server-side auth gate for pages. Authoritative (validates with the Auth server). */
export async function requireUser(nextPath: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return { supabase, user };
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
  const user = auth.status === "fulfilled" ? auth.value.data.user : null;
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (data.status === "rejected") throw data.reason;
  return { supabase, user, loaded: data.value };
}
