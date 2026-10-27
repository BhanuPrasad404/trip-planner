import { nextStep, tierById, type BadgeDTO, type TierId } from "@/lib/social/standing";

// The badge a traveler earns by helping others decide. One crest, four colours (theme colours only), the name always written
// beside it or given to screen readers: colour is never the only signal.
const TONE: Record<TierId, { crest: string; ring: string; pill: string }> = {
  helpful: { crest: "text-teal", ring: "", pill: "bg-teal-light text-teal-ink" },
  trusted: { crest: "text-marigold", ring: "", pill: "bg-marigold-light text-marigold-ink" },
  guide: { crest: "text-clay", ring: "", pill: "bg-clay-light text-clay-ink" },
  legend: { crest: "text-pine", ring: "ring-2 ring-marigold rounded-full", pill: "bg-pine text-white" },
};

/** The crest: a shield with a star. Higher badges get more points on the star, so the shape changes too, not only the colour. */
export function Crest({ tier, size = 16, className = "" }: { tier: TierId; size?: number; className?: string }) {
  const points = { helpful: 4, trusted: 5, guide: 6, legend: 8 }[tier];
  const star = Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 === 0 ? 4.2 : 1.9, a = (Math.PI * i) / points - Math.PI / 2;
    return `${(12 + r * Math.cos(a)).toFixed(2)},${(11 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  return (
    <span className={`inline-flex shrink-0 ${TONE[tier].crest} ${TONE[tier].ring} ${className}`} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" focusable="false">
        <path d="M12 2.2 20 5v6.3c0 5-3.4 8.8-8 10.5-4.6-1.7-8-5.5-8-10.5V5l8-2.8Z" fill="currentColor" />
        <polygon points={star} className="fill-white" />
      </svg>
    </span>
  );
}

/** Small: beside a name on a card. The name of the badge goes to screen readers and the tooltip. */
export function BadgeMark({ badge }: { badge: BadgeDTO | null | undefined }) {
  const t = tierById(badge?.tier);
  if (!badge || (!t && !badge.place)) return null;
  const label = [t?.name, badge.place ? `Local voice: ${badge.place}` : null].filter(Boolean).join(", ");
  return (
    <span className="inline-flex shrink-0 items-center gap-1" title={label}>
      {t ? <Crest tier={t.id} size={15} /> : <Crest tier="helpful" size={15} />}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Medium: written out, for the post page and comments. */
export function BadgePills({ badge }: { badge: BadgeDTO | null | undefined }) {
  const t = tierById(badge?.tier);
  if (!badge || (!t && !badge.place)) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {t && <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${TONE[t.id].pill}`}><Crest tier={t.id} size={14} className={t.id === "legend" ? "text-marigold" : ""} />{t.name}</span>}
      {badge.place && <span className="inline-flex min-h-7 items-center rounded-full border border-line px-2.5 text-xs font-semibold text-pine">Local voice: {badge.place}</span>}
    </span>
  );
}

/** Large: the profile. What they earned, what it means, and (on your own page) how close the next one is. */
export function StandingCard({ helped, tier, place, mine }: { helped: number; tier: TierId | null; place: { name: string; helped: number } | null; mine: boolean }) {
  const t = tierById(tier);
  const next = nextStep(helped);
  return (
    <section aria-label="Traveler standing" className="rounded-3xl border border-line bg-white p-5">
      <div className="flex items-center gap-4">
        {t ? <Crest tier={t.id} size={64} /> : <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-line text-2xl text-ink-muted">?</span>}
        <div className="min-w-0">
          <p className="font-display text-2xl font-semibold leading-tight text-pine">{t ? t.name : mine ? "No badge yet" : "New on Trailmate"}</p>
          <p className="mt-0.5 text-sm text-ink-muted">{t ? t.meaning : mine ? "Share what a place is like. When travelers use your posts to decide, you earn your first badge." : "Hasn't earned a badge yet."}</p>
        </div>
      </div>
      <p className="mt-4 text-sm text-ink"><strong className="font-display text-xl font-semibold text-pine tabular-nums">{helped}</strong> {helped === 1 ? "traveler" : "travelers"} helped to decide</p>
      {place && <p className="mt-2"><span className="inline-flex min-h-8 items-center rounded-full bg-teal-light px-3 text-sm font-semibold text-teal-ink">Local voice: {place.name}</span> <span className="text-xs text-ink-muted">{place.helped} travelers helped there</span></p>}
      {mine && next && (
        <div className="mt-4">
          <div className="flex justify-between text-xs font-semibold text-ink-muted"><span>Next: {next.tier.name}</span><span>{next.remaining} more {next.remaining === 1 ? "traveler" : "travelers"}</span></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sky" role="progressbar" aria-label={`Progress to ${next.tier.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(next.progress * 100)}>
            <div className="h-full rounded-full bg-teal" style={{ width: `${Math.round(next.progress * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-ink-muted">It counts different travelers who marked your posts &quot;helped me decide&quot; or added the place to their trip. Each person counts once.</p>
        </div>
      )}
    </section>
  );
}
