type Props = { posts: number; destinations: number; travelersHelped: number; saves: number; helpful: number; tripAdds: number };

/** What your posts have done for other travelers. Counted from OTHER people's actions only — never from anything self-reported. */
export function ContributionCard({ posts, destinations, travelersHelped, saves, helpful, tripAdds }: Props) {
  return (
    <section aria-labelledby="contribution-heading" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="contribution-heading" className="font-display text-lg font-semibold text-pine">Your contribution</h2>
      {posts === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Share one place you&apos;ve been — a photo, a short video or a quick condition report. It could help someone plan their trip, and you&apos;ll see here how many travelers it reached.</p>
      ) : (
        <>
          <p className="mt-2 text-base text-pine"><strong className="font-display text-3xl tabular-nums">{travelersHelped}</strong> <span className="text-ink-muted">traveler{travelersHelped === 1 ? "" : "s"} helped by your posts</span></p>
          <dl className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {([["Posts", posts], ["Destinations", destinations], ["Saved", saves], ["Found helpful", helpful], ["Added to trips", tripAdds]] as const).map(([label, n]) => (
              <div key={label} className="rounded-xl bg-sky/70 px-3 py-2.5 text-center"><dd className="font-display text-xl font-semibold tabular-nums text-pine">{n}</dd><dt className="text-xs text-ink-muted">{label}</dt></div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-ink-muted">Counted from other travelers&apos; actions only: saves, &ldquo;helpful&rdquo; marks and trip additions. Your own don&apos;t count.</p>
        </>
      )}
    </section>
  );
}
