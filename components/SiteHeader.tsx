import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { Logo } from "./Logo";
import { Button, LinkButton } from "./ui/Button";

async function getUserSafe() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    // Missing env / Auth outage: render the signed-out header instead of crashing the page.
    return null;
  }
}

export async function SiteHeader({ tone = "light" }: { tone?: "light" | "dark" }) {
  const user = await getUserSafe();
  const dark = tone === "dark";

  return (
    <header className={dark ? "bg-pine text-white" : "bg-transparent text-pine"}>
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href={user ? "/trips" : "/"} aria-label="Trailmate home" className="rounded-lg">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-2">
          {user ? (
            <>
              <Link
                href="/trips"
                className={`hidden rounded-lg px-3 py-2 text-sm font-semibold sm:block ${
                  dark ? "hover:bg-white/10" : "hover:bg-pine/10"
                }`}
              >
                My trips
              </Link>
              <form action={signOut}>
                <Button type="submit" variant={dark ? "secondary" : "ghost"} size="sm">
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  dark ? "hover:bg-white/10" : "hover:bg-pine/10"
                }`}
              >
                Log in
              </Link>
              <LinkButton href="/signup" size="sm">
                Get started
              </LinkButton>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}