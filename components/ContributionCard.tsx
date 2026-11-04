type Props = { posts: number; destinations: number; travelersHelped: number; saves: number; helpful: number; tripAdds: number };

/** What your posts have done for other travelers. Counted from OTHER people's actions only — never from anything self-reported. */
export function ContributionCard({ posts, destinations, travelersHelped, saves, helpful, tripAdds }: Props) {
  return (
    <section aria-labelledby="contribution-heading" className="relative overflow-hidden rounded-[2rem] border border-teal/20 bg-gradient-to-br from-teal-light via-teal-light/70 to-white p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-marigold-ink shadow-card ring-1 ring-teal/20">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z" /></svg>
        </span>
        <div className="min-w-0 flex-1 sm:pr-28">
          <h2 id="contribution-heading" className="font-display text-xl font-semibold text-pine">Your contribution</h2>
          {posts === 0 ? (
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">Share one place you&apos;ve been — a photo, a short video or a quick condition report. It could help someone plan their trip, and you&apos;ll see here how many travelers it reached.</p>
          ) : (
            <p className="mt-1.5 text-base text-pine"><strong className="font-display text-3xl tabular-nums">{travelersHelped}</strong> <span className="text-ink-muted">traveler{travelersHelped === 1 ? "" : "s"} helped by your posts</span></p>
          )}
        </div>
      </div>
      {/* A small drawn postcard, tilted: the mood of a shared photo (decorative, not a real photograph) */}
      <svg aria-hidden="true" viewBox="0 0 120 96" className="pointer-events-none absolute right-4 top-4 hidden h-24 w-28 rotate-6 rounded-xl shadow-float ring-4 ring-white sm:block">
        <rect width="120" height="96" fill="var(--marigold-light)" />
        <circle cx="86" cy="26" r="11" fill="var(--marigold)" />
        <path d="M0 96V58c20-18 36-14 54 2 20-24 42-22 66-4v40z" fill="var(--teal)" opacity="0.75" />
        <path d="M0 96V74c24-12 44-8 62 4 20-10 38-8 58 2v16z" fill="var(--pine)" />
      </svg>
      {posts > 0 && (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {([["Posts", posts], ["Destinations", destinations], ["Saved", saves], ["Found helpful", helpful], ["Added to trips", tripAdds]] as const).map(([label, n]) => (
              <div key={label} className="rounded-2xl bg-white/80 px-3 py-2.5 text-center ring-1 ring-teal/10"><dd className="font-display text-xl font-semibold tabular-nums text-pine">{n}</dd><dt className="text-xs text-ink-muted">{label}</dt></div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-ink-muted">Counted from other travelers&apos; actions only: saves, &ldquo;helpful&rdquo; marks and trip additions. Your own don&apos;t count.</p>
        </>
      )}
    </section>
  );
}
