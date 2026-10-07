import Link from "next/link";
import { SeasonBadge } from "@/components/SeasonBadge";
import { SiteHeader } from "@/components/SiteHeader";
import { Logo } from "@/components/Logo";
import { LinkButton } from "@/components/ui/Button";
import { getSiteUrl } from "@/lib/env";

const features = [
  {
    title: "Knows when to go",
    body: "Every stop is checked against curated season data for the day you'll actually be there — so you skip the waterfall that's dry in May.",
  },
  {
    title: "Plans the route, not just the list",
    body: "Drop in places from reels and links. Trailmate orders them by proximity and spreads them across days, so you stop zig-zagging across the state.",
  },
  {
    title: "One plan for the whole group",
    body: "Share a single invite link on WhatsApp. Everyone sees the same itinerary, with live group location on the way.",
  },
];

const steps = [
  { n: "1", title: "Collect your places", body: "Add stops by hand or paste the reel that inspired them." },
  { n: "2", title: "Check the season", body: "See instantly which stops are worth it for your travel dates." },
  { n: "3", title: "Auto-plan & share", body: "Get a day-by-day route, then invite your group in one tap." },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Trailmate",
  applicationCategory: "TravelApplication",
  description: "Season-aware group trip planner.",
  url: getSiteUrl(),
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader />

      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-14 pt-8 sm:px-6 lg:grid-cols-2 lg:gap-14 lg:pb-20 lg:pt-14">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-teal-ink">Group trip planner</p>
            <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.1] text-pine sm:text-5xl lg:text-6xl">
              The trip planner that knows when to go.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-muted">
              Trailmate checks every place against the season you&apos;re travelling in, orders your stops so the route
              makes sense, and keeps the whole group on one plan.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <LinkButton href="/signup">Plan your first trip</LinkButton>
              <LinkButton href="/login" variant="secondary">
                I already have an account
              </LinkButton>
            </div>
          </div>

          {/* Static product preview — illustrative sample, not live data */}
          <div className="mx-auto w-full max-w-md lg:max-w-none">
            <div className="overflow-hidden rounded-3xl bg-white shadow-2xl shadow-pine/20 ring-1 ring-line">
              <div className="bg-pine px-5 py-4 text-white">
                <p className="text-xs font-semibold uppercase tracking-widest text-white/75">Illustration · not a real trip</p>
                <p className="mt-1 font-display text-2xl font-semibold">Hyderabad → Maharashtra</p>
              </div>
              <ol className="px-5 py-2">
                {[
                  { time: "08:30", name: "Tiger's Leap Viewpoint", status: "good" as const },
                  {
                    time: "11:00",
                    name: "Kalu Waterfall",
                    status: "wrong_season" as const,
                    note: "Dry outside monsoon (Jun–Sep) — not worth visiting other months.",
                  },
                  { time: "13:30", name: "Della Adventure Park", status: "good" as const },
                ].map((s) => (
                  <li key={s.name} className="flex gap-3 border-b border-line py-4 last:border-b-0">
                    <span className="w-12 shrink-0 pt-0.5 font-mono text-xs text-ink-muted">{s.time}</span>
                    <div>
                      <p className="text-base font-semibold">{s.name}</p>
                      <div className="mt-1.5">
                        <SeasonBadge status={s.status} />
                      </div>
                      {s.note && <p className="mt-2 text-sm text-ink-muted">{s.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <p className="mt-3 text-center text-xs text-ink-muted">An example of how a day looks — the stops and times here are made up to show the idea.</p>
          </div>
        </section>

        {/* Features */}
        <section aria-labelledby="features-heading" className="bg-white py-14 lg:py-20">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <h2 id="features-heading" className="font-display text-3xl font-semibold text-pine sm:text-4xl">
              Built for how groups really travel
            </h2>
            <ul className="mt-8 grid gap-5 md:grid-cols-3">
              {features.map((f) => (
                <li key={f.title} className="rounded-2xl border border-line bg-sky/50 p-6">
                  <h3 className="font-display text-xl font-semibold text-pine">{f.title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-ink-muted">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-heading" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
          <h2 id="how-heading" className="font-display text-3xl font-semibold text-pine sm:text-4xl">
            How it works
          </h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {steps.map((s) => (
              <li key={s.n} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-marigold font-mono text-base text-pine">
                  {s.n}
                </span>
                <div>
                  <h3 className="text-lg font-semibold">{s.title}</h3>
                  <p className="mt-1 text-base text-ink-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* CTA */}
        <section className="bg-pine py-14 text-center text-white">
          <div className="mx-auto max-w-2xl px-4">
            <h2 className="font-display text-3xl font-semibold sm:text-4xl">Stop planning trips that fall flat.</h2>
            <p className="mt-3 text-lg text-white/85">Free to start. Takes a minute to set up.</p>
            <LinkButton href="/signup" className="mt-6">
              Create your account
            </LinkButton>
          </div>
        </section>
      </main>

      <footer className="bg-pine/95 py-8 text-white/80">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm sm:flex-row sm:px-6">
          <Logo className="text-white" />
          <p>© {new Date().getFullYear()} Trailmate</p>
          <nav aria-label="Footer" className="flex gap-4">
            <Link href="/login" className="underline underline-offset-2">Log in</Link>
            <Link href="/signup" className="underline underline-offset-2">Sign up</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
