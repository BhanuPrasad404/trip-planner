/** `tagline`: the phone header's version: a larger mark, "TrailMate" and the line "Plan · Ride · Explore" beneath it. */
export function Logo({ className = "", tagline = false }: { className?: string; tagline?: boolean }) {
  if (tagline) {
    return (
      <span className={`inline-flex items-center gap-3 ${className}`}>
        <svg width="44" height="44" viewBox="0 0 26 26" fill="none" aria-hidden="true" className="shrink-0 drop-shadow-[0_3px_8px_rgba(201,128,21,0.35)]">
          <circle cx="13" cy="13" r="13" fill="#E8A33D" />
          <path d="M5 18.5l4.6-6.2 2.6 3.2 3-5.4 5.8 8.4z" fill="#0B3D3A" />
          <path d="M6 20.5c3-1.2 6-.3 9-1.4 2-.7 3.6-.6 5-1.1" stroke="#0B3D3A" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="0.1 2.4" />
        </svg>
        <span className="flex flex-col leading-none">
          <span className="font-display text-[28px] font-semibold tracking-tight text-pine">TrailMate</span>
          <span className="mt-1.5 text-[13px] font-medium text-ink-muted">Plan <span aria-hidden="true">·</span><span className="sr-only">, </span> Ride <span aria-hidden="true">·</span><span className="sr-only">, </span> Explore</span>
        </span>
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-2 font-display text-xl font-semibold ${className}`}>
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <circle cx="13" cy="13" r="13" fill="#E8A33D" />
        <path
          d="M6 18c3-1 3-5 6-5s3-4 8-5"
          stroke="#0B3D3A"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray="0.1 4.2"
        />
        <circle cx="6" cy="18" r="2" fill="#0B3D3A" />
        <circle cx="20" cy="8" r="2" fill="#0B3D3A" />
      </svg>
      Trailmate
    </span>
  );
}
