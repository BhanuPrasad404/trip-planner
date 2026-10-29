// The first thing anyone sees while Trailmate opens: the start of a road trip in the round window of the logo. A dawn sun rises once
// behind two layers of hills while the road's centre line keeps flowing towards you; the name settles in underneath. Colours are the
// theme's --tm-load-* tokens (app/globals.css): a pale dawn on the app's warm white, the same warm white the phone shows as its own
// splash before this appears (app/manifest.ts), so opening the installed app is one continuous screen. Still for reduced motion.
export function AppLoader({ size = 168, label = "Loading Trailmate" }: { size?: number; label?: string }) {
  return (
    <span role="status" className="tm-roadload inline-flex flex-col items-center gap-4">
      <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" className="drop-shadow-[0_10px_28px_var(--tm-load-shadow)]">
        <defs>
          <clipPath id="tm-roadload-window"><circle cx="100" cy="100" r="98" /></clipPath>
          <linearGradient id="tm-roadload-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--tm-load-sky-top)" />
            <stop offset="0.7" stopColor="var(--tm-load-sky-bottom)" />
          </linearGradient>
          <radialGradient id="tm-roadload-glow">
            <stop offset="0" stopColor="var(--tm-load-sun)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--tm-load-sun)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g clipPath="url(#tm-roadload-window)">
          <rect width="200" height="200" fill="url(#tm-roadload-sky)" />
          <g className="tm-roadload-sun">
            <circle cx="100" cy="112" r="56" fill="url(#tm-roadload-glow)" />
            <circle cx="100" cy="112" r="23" fill="var(--tm-load-sun)" />
          </g>
          <path d="M0 118 C 28 100, 52 104, 78 113 C 104 99, 128 97, 152 108 C 170 103, 186 104, 200 110 V 200 H 0 Z" fill="var(--tm-load-hill-far)" />
          <path d="M0 140 C 24 124, 48 127, 70 135 C 86 128, 112 127, 130 135 C 152 125, 178 124, 200 133 V 200 H 0 Z" fill="var(--tm-load-hill-near)" />
          <path d="M97.8 130 C 93 152, 64 170, 38 200 L 136 200 C 120 170, 105 152, 102.2 130 Z" fill="var(--tm-load-road)" />
          <path className="tm-roadload-line" d="M100 132 C 99 152, 92 170, 87 200" fill="none" stroke="var(--tm-load-line)" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="5 9" />
        </g>
        <circle cx="100" cy="100" r="98" fill="none" stroke="var(--tm-load-ring)" strokeWidth="2" />
      </svg>
      <span aria-hidden="true" className="flex flex-col items-center gap-1.5">
        <span className="tm-roadload-name font-display text-[28px] font-semibold leading-none tracking-tight text-pine">TrailMate</span>
        <span className="tm-roadload-tag text-[13px] font-medium text-ink-muted">Plan · Ride · Explore</span>
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
