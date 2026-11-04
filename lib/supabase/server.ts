// Server-side Supabase client — use in Server Components, Route Handlers, Server Actions
import { createServerClient } from "@supabase/ssr";
import { cache } from "react";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/lib/env";

/** Calls that change who is signed in (or their record): the remembered answer to "who is this?" must not outlive them. */
const CHANGES_WHO = ["updateUser", "signOut", "signInWithPassword", "signInWithOAuth", "signInWithOtp", "signUp", "verifyOtp", "exchangeCodeForSession", "setSession", "refreshSession"] as const;

async function build() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component (read-only cookies). Safe to ignore:
          // proxy.ts refreshes the session on every request.
        }
      },
    },
  });

  // ONE "who is this?" question to the Auth server per request. The page, the layout around it and the navigation each used to ask it
  // again (about 100-200 ms of waiting each). The Auth server still decides every time a request starts; this only stops one request from
  // asking the same question three times. Anything that changes who is signed in forgets the answer.
  const auth = client.auth as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const realGetUser = auth.getUser.bind(client.auth);
  let asked: Promise<unknown> | null = null;
  auth.getUser = (...args: unknown[]) => {
    if (args.length > 0) return realGetUser(...args);                    // a specific token: not "the current person"
    if (!asked) asked = realGetUser().catch((e) => { asked = null; throw e; });
    return asked;
  };
  for (const name of CHANGES_WHO) {
    const real = auth[name]?.bind(client.auth);
    if (real) auth[name] = (...args: unknown[]) => { asked = null; return real(...args).finally(() => { asked = null; }); };
  }
  return client;
}

// `cache`: the same client for everything that renders in one request (a route handler or action simply gets a fresh one each call).
export const createClient = cache(build);
