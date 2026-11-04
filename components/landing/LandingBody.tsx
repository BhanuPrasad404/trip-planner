import Link from "next/link";
import { LandingSample } from "@/components/LandingSample";
import { SAMPLE_MONTHS, sampleStops } from "@/lib/landing-sample";
import { Logo } from "@/components/Logo";
import { LinkButton } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { PhotoBackdrop } from "@/components/landing/PhotoBackdrop";
import { PhoneDemo } from "@/components/landing/PhoneDemo";
import { Destinations } from "@/components/landing/Destinations";
import { Faq } from "@/components/landing/Faq";
import { CountUp, Reveal } from "@/components/landing/Motion";
import { FEATURES, KIND_STRIP, STATS, STEPS, TRUST } from "@/lib/landing-content";

const onDark = "!border-white/30 !bg-white/10 !text-white hover:!bg-white/20 !shadow-none";

/** Everything under the header: the hero, the sections a visitor scrolls through, and the footer. */
export function LandingBody() {
  return (
    <>
      <main id="main" className="flex-1 overflow-x-clip">
        {/* ── Hero: dawn over the hills, the promise, and the real app ── */}
        <section aria-labelledby="hero-heading" className="relative isolate -mt-px overflow-hidden rounded-b-[2.5rem] bg-ink text-white sm:rounded-b-[4rem]">
          <PhotoBackdrop keys={["taj", "jaisalmer", "mysore", "golden"]} />
          <div className="relative mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-4 pb-40 pt-8 sm:px-6 sm:pb-48 sm:pt-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10 lg:pt-16">
            <div>
              <p className="tm-rise inline-flex items-center gap-2 rounded-full bg-ink/70 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-widest text-marigold ring-1 ring-white/15 backdrop-blur" style={{ animationDelay: "80ms" }}>
                <Glyph name="sparkles" size={14} />Trip planner for India
              </p>
              <h1 id="hero-heading" className="tm-rise mt-5 font-display text-[2.6rem] font-semibold leading-[1.05] sm:text-6xl lg:text-7xl" style={{ animationDelay: "180ms" }}>
                Know where to go.<br /><span className="text-marigold">Know when.</span>
              </h1>
              <p className="tm-rise mt-5 max-w-xl text-lg leading-relaxed text-white/85 sm:text-xl" style={{ animationDelay: "320ms" }}>
                Discover forts, temples, waterfalls and beaches across every state, see which month suits each one, get a route that makes sense, and follow it live with your whole group.
              </p>
              <div className="tm-rise mt-8 flex flex-col gap-3 sm:flex-row" style={{ animationDelay: "460ms" }}>
                <LinkButton href="/signup" className="sm:min-w-[14rem]">Plan your first trip<Glyph name="arrow" size={18} /></LinkButton>
                <LinkButton href="/login" variant="secondary" className={onDark}>I already have an account</LinkButton>
              </div>
              <ul className="tm-rise mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/80" style={{ animationDelay: "600ms" }}>
                {["Free to start", "Works on your phone", "No made-up ratings"].map((t) => <li key={t} className="inline-flex items-center gap-1.5"><Glyph name="checkCircle" size={16} className="text-marigold" />{t}</li>)}
              </ul>
            </div>
            <div className="tm-rise mx-auto w-full max-w-sm lg:max-w-none" style={{ animationDelay: "380ms" }}>
              <div className="tm-float"><PhoneDemo onDark /></div>
            </div>
          </div>
          <a href="#numbers" aria-label="Scroll to see more" className="absolute bottom-24 left-1/2 hidden -translate-x-1/2 animate-bounce flex-col items-center gap-1 text-xs font-semibold text-white/70 motion-reduce:animate-none sm:flex">Scroll<Glyph name="down" size={18} /></a>
        </section>

        {/* ── The numbers, from the product itself ── */}
        <section id="numbers" aria-label="Trailmate in numbers" className="relative z-10 -mt-24 px-4 sm:-mt-28 sm:px-6">
          <Reveal className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-px overflow-hidden rounded-3xl bg-line shadow-float ring-1 ring-line lg:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="bg-white px-5 py-6 text-center sm:py-8">
                <p className="font-display text-4xl font-semibold text-pine sm:text-5xl"><CountUp to={s.to} suffix={s.suffix} /></p>
                <p className="mt-1 text-sm font-semibold text-teal-ink">{s.label}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{s.note}</p>
              </div>
            ))}
          </Reveal>
        </section>

        {/* ── A moving strip of what you can find ── */}
        <section aria-label="Kinds of places" className="mt-10 overflow-hidden py-3">
          <div className="tm-marquee flex w-max gap-3 pr-3">
            {[...KIND_STRIP, ...KIND_STRIP].map((k, i) => (
              <span key={`${k}-${i}`} aria-hidden={i >= KIND_STRIP.length ? true : undefined} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-pine ring-1 ring-line"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-marigold" />{k}</span>
            ))}
          </div>
        </section>

        {/* ── Real places, real photos ── */}
        <section aria-labelledby="places-heading" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <Reveal className="max-w-2xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold-ink">Discover</p>
            <h2 id="places-heading" className="mt-2 font-display text-3xl font-semibold text-pine sm:text-5xl">From the Golden Temple to the Gateway of India</h2>
            <p className="mt-3 text-lg text-ink-muted">Every state, every kind of place. Explore well-known icons and the quieter spots near them, each with where its information came from.</p>
          </Reveal>
          <div className="mt-8"><Destinations /></div>
          <Reveal className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">Photos from Wikipedia and Wikimedia Commons, each credited to its author under its free licence.</p>
            <LinkButton href="/signup" variant="secondary" size="sm">Explore places near you<Glyph name="arrow" size={16} /></LinkButton>
          </Reveal>
        </section>

        {/* ── Knows when to go ── */}
        <section aria-labelledby="when-heading" className="bg-white py-16 lg:py-24">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
            <Reveal>
              <p className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold-ink">The point of Trailmate</p>
              <h2 id="when-heading" className="mt-2 font-display text-3xl font-semibold text-pine sm:text-5xl">The same place can be perfect or pointless, depending on the month.</h2>
              <p className="mt-4 text-lg leading-relaxed text-ink-muted">A waterfall can be a roaring wonder in August and a dry rock in May. A fort is a joy in December and an oven in May. Trailmate checks every place against the month you travel and shows you the numbers behind each pick.</p>
              <ul className="mt-6 space-y-3 text-base text-ink">
                {["Picks change with where you are and the month you choose", "Typical daily high and rain for that month, shown on every card", `Hand-researched season notes, with sources, where we have them`].map((t) => (
                  <li key={t} className="flex items-start gap-3"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-light text-teal-ink"><Glyph name="check" size={14} strokeWidth={3} /></span>{t}</li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={150} className="mx-auto w-full max-w-md lg:max-w-none">
              <LandingSample byMonth={Object.fromEntries(SAMPLE_MONTHS.map((m) => [m, sampleStops(m)]))} />
              <p className="mt-3 text-center text-xs text-ink-muted">Example from our researched season data (the sources are listed on each place in the app). Your own trip uses your dates, live weather and your own places.</p>
            </Reveal>
          </div>
        </section>

        {/* ── Everything it does ── */}
        <section aria-labelledby="features-heading" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold-ink">Everything in one place</p>
            <h2 id="features-heading" className="mt-2 font-display text-3xl font-semibold text-pine sm:text-5xl">Built for how groups really travel</h2>
          </Reveal>
          <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal as="li" key={f.title} delay={(i % 3) * 100} className="group rounded-3xl border border-line bg-white p-6 transition duration-300 hover:-translate-y-1 hover:border-teal/40 hover:shadow-float">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-light text-teal-ink transition duration-300 group-hover:rotate-6 group-hover:bg-pine group-hover:text-white"><Glyph name={f.glyph} size={24} /></span>
                <h3 className="mt-4 font-display text-xl font-semibold text-pine">{f.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-ink-muted">{f.body}</p>
              </Reveal>
            ))}
          </ul>
        </section>

        {/* ── How it works ── */}
        <section aria-labelledby="how-heading" className="bg-sky/70 py-16 lg:py-24">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <Reveal className="max-w-2xl">
              <p className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold-ink">How it works</p>
              <h2 id="how-heading" className="mt-2 font-display text-3xl font-semibold text-pine sm:text-5xl">From a scroll of reels to a route you can follow</h2>
            </Reveal>
            <Reveal className="relative mt-12">
              <svg aria-hidden="true" viewBox="0 0 1000 60" preserveAspectRatio="none" className="absolute left-[8%] right-[8%] top-3 hidden h-10 w-[84%] md:block">
                <path pathLength="1" className="tm-route-path" d="M0 30C120 -10 220 70 340 30S560 -10 680 30 900 70 1000 30" fill="none" stroke="var(--marigold)" strokeWidth="3" strokeLinecap="round" strokeDasharray="1" />
              </svg>
              <ol className="relative grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="relative">
                    <span className="tm-pop-in flex h-14 w-14 items-center justify-center rounded-full bg-marigold font-display text-2xl font-semibold text-pine shadow-lg" style={{ "--tm-delay": `${300 + i * 500}ms` } as React.CSSProperties}>{i + 1}</span>
                    <h3 className="mt-4 font-display text-xl font-semibold text-pine">{s.title}</h3>
                    <p className="mt-2 text-base leading-relaxed text-ink-muted">{s.body}</p>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </section>

        {/* ── Why you can trust it ── */}
        <section aria-labelledby="trust-heading" className="bg-ink py-16 text-white lg:py-24">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <Reveal className="max-w-2xl">
              <p className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold">Honest by design</p>
              <h2 id="trust-heading" className="mt-2 font-display text-3xl font-semibold sm:text-5xl">A planner that tells you what it knows, and what it doesn&apos;t</h2>
            </Reveal>
            <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {TRUST.map((t, i) => (
                <Reveal as="li" key={t.title} delay={(i % 2) * 120} className="rounded-3xl bg-white/[0.07] p-6 ring-1 ring-white/10 backdrop-blur transition duration-300 hover:bg-white/10">
                  <h3 className="font-display text-xl font-semibold">{t.title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-white/80">{t.body}</p>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Questions ── */}
        <section aria-labelledby="faq-heading" className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 lg:py-24">
          <Reveal className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold-ink">Good to know</p>
            <h2 id="faq-heading" className="mt-2 font-display text-3xl font-semibold text-pine sm:text-5xl">Questions, answered</h2>
          </Reveal>
          <Reveal className="mt-8" delay={100}><Faq /></Reveal>
        </section>

        {/* ── The invitation ── */}
        <section aria-labelledby="cta-heading" className="relative isolate overflow-hidden bg-ink py-20 text-center text-white lg:py-28">
          <PhotoBackdrop keys={["hampi", "konark", "meenakshi", "gateway"]} side="center" />
          <Reveal className="relative mx-auto max-w-2xl px-4">
            <h2 id="cta-heading" className="font-display text-4xl font-semibold sm:text-6xl">Your next trip starts with one good place.</h2>
            <p className="mt-4 text-lg text-white/85">Free to start. Takes about a minute to set up.</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <LinkButton href="/signup" className="sm:min-w-[14rem]">Create your account<Glyph name="arrow" size={18} /></LinkButton>
              <LinkButton href="/login" variant="secondary" className={onDark}>Log in</LinkButton>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="bg-ink text-white/80">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-4 py-12 sm:grid-cols-[1.4fr_1fr_1fr] sm:px-6">
          <div>
            <Logo className="text-white" />
            <p className="mt-3 max-w-xs text-sm text-white/70">The trip planner that knows when to go. Made for travelling in India, with friends and family.</p>
          </div>
          <nav aria-label="Product" className="text-sm">
            <p className="font-semibold text-white">Trailmate</p>
            <ul className="mt-3 space-y-2"><li><Link href="/signup" className="hover:text-white">Sign up</Link></li><li><Link href="/login" className="hover:text-white">Log in</Link></li></ul>
          </nav>
          <nav aria-label="Legal" className="text-sm">
            <p className="font-semibold text-white">Legal</p>
            <ul className="mt-3 space-y-2"><li><Link href="/privacy" className="hover:text-white">Privacy</Link></li><li><Link href="/terms" className="hover:text-white">Terms</Link></li></ul>
          </nav>
        </div>
        <div className="border-t border-white/10 py-5 text-center text-xs text-white/60">© {new Date().getFullYear()} Trailmate · Place data © OpenStreetMap contributors and Wikidata · Photos from Wikimedia Commons</div>
      </footer>
    </>
  );
}
