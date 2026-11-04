// The first thing anyone sees while Trailmate opens: the whole screen in the brand's marigold yellow, and the mark building itself in the
// middle. Rings of light spread from the centre, a cream sun pops in, the two hills rise, the dotted trail lays down one dot at a time,
// and the name settles in. It is the same yellow the phone shows as its own splash before this appears (app/manifest.ts, lib/pwa.tsx),
// so opening the installed app is one continuous screen. Everything is drawn here (no image to load). Still for reduced motion.
const DOTS = [[30, 172], [52, 176], [76, 175], [100, 170], [124, 168], [148, 171], [172, 166]] as const;

export function AppLoader({ size = 176, label = "Loading Trailmate" }: { size?: number; label?: string }) {
  return (
    <div role="status" className="tm-splash fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 overflow-hidden bg-marigold">
      <div aria-hidden="true" className="tm-splash-glow pointer-events-none absolute left-1/2 top-1/2 h-[120vmax] w-[120vmax] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,var(--marigold-light)_0%,transparent_58%)] opacity-60" />
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        {[0, 1, 2].map((i) => <span key={i} aria-hidden="true" className="tm-splash-ring absolute inset-0 rounded-full border-2 border-white/60" style={{ animationDelay: `${0.5 + i * 0.9}s` }} />)}
        <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" className="relative drop-shadow-[0_12px_24px_var(--tm-load-shadow)]">
          <circle className="tm-splash-sun" cx="150" cy="52" r="21" fill="var(--marigold-light)" />
          <g className="tm-splash-hills">
            <path d="M14 152 L74 76 L102 112 L138 54 L190 152 Z" fill="var(--pine)" />
            <path d="M74 76 L88 94 L80 100 L68 90 Z" fill="var(--marigold)" opacity="0.28" />
          </g>
          {DOTS.map(([x, y], i) => <circle key={i} className="tm-splash-dot" cx={x} cy={y} r="5.2" fill="var(--pine)" style={{ animationDelay: `${1.05 + i * 0.12}s` }} />)}
        </svg>
      </div>
      <div aria-hidden="true" className="relative flex flex-col items-center gap-1.5 text-pine">
        <span className="tm-splash-name font-display text-[44px] font-semibold leading-none tracking-tight">TrailMate</span>
        <span className="tm-splash-tag text-sm font-semibold uppercase tracking-[0.28em]">Plan · Ride · Explore</span>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
