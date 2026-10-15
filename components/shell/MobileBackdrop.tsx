/**
 * The scene behind the whole app on phones: golden-hour sky, layered mountains and pines, fading into deep forest green so every card and
 * every line of text sits on a dark, calm surface. Drawn as a small inline vector (no image to download, no licence, scales to any phone,
 * nothing moves, nothing to repaint while scrolling). Hidden from screen readers and never catches a tap. Not shown from 768 px up.
 *
 * Want a real photograph instead? Put the file in /public/brand/ and set HERO_PHOTO to its path (e.g. "/brand/mobile-hero.webp"). A tall
 * photo of about 1170×1400 works well; the dark fade below keeps the text readable whatever the picture. Nothing else needs to change.
 */
export const HERO_PHOTO: string | null = null;

/** The scene's colours, kept together so they can be checked for readability (tests/mobile-theme.test.ts) and changed in one place. */
export const BACKDROP_COLORS = {
  ground: "#06201c",
  // Where text can sit directly on the scene (page titles), the lightest the scene gets: the far ridge, hazed by the fade.
  farRidge: "#2d6b60",
  // The bright band is kept behind the header and the search pill, which carry their own dark glass.
  horizon: "#f7b963",
} as const;

export function MobileBackdrop() {
  return (
    <div aria-hidden="true" data-mobile-backdrop className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#06201c] md:hidden">
      {HERO_PHOTO ? (
        // eslint-disable-next-line @next/next/no-img-element -- a decorative, optional brand image; sized by the container
        <img src={HERO_PHOTO} alt="" className="absolute inset-x-0 top-0 h-[58%] w-full object-cover object-top" />
      ) : (
        <svg viewBox="0 0 390 800" preserveAspectRatio="xMidYMin slice" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="tm-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0a2b2a" />
              <stop offset="0.3" stopColor="#173f3b" />
              <stop offset="0.55" stopColor="#8a5a38" />
              <stop offset="0.8" stopColor="#f0a24a" />
              <stop offset="1" stopColor={BACKDROP_COLORS.horizon} />
            </linearGradient>
            <radialGradient id="tm-glow" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ffe9b0" stopOpacity="0.95" />
              <stop offset="0.35" stopColor="#ffb347" stopOpacity="0.5" />
              <stop offset="1" stopColor="#ff9a3c" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="tm-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={BACKDROP_COLORS.ground} stopOpacity="0" />
              <stop offset="1" stopColor={BACKDROP_COLORS.ground} />
            </linearGradient>
            <pattern id="tm-pines" width="22" height="46" patternUnits="userSpaceOnUse">
              <path d="M11 2 L19 20 H14 L21 36 H1 L8 20 H3 Z" fill="#082b27" />
            </pattern>
          </defs>
          <rect width="390" height="175" fill="url(#tm-sky)" />
          <circle cx="292" cy="98" r="130" fill="url(#tm-glow)" />
          <circle cx="292" cy="98" r="19" fill="#fff3c9" />
          <ellipse cx="70" cy="62" rx="110" ry="9" fill="#f3b47a" opacity="0.18" />
          <ellipse cx="170" cy="118" rx="140" ry="8" fill="#f6c58a" opacity="0.22" />
          <path d="M0 160 L38 140 L84 158 L138 122 L196 154 L256 118 L318 152 L366 132 L390 142 V300 H0Z" fill={BACKDROP_COLORS.farRidge} opacity="0.6" />
          <path d="M0 200 L52 168 L112 194 L172 160 L240 198 L304 164 L362 192 L390 176 V320 H0Z" fill="#1a5148" opacity="0.85" />
          <path d="M0 246 L60 214 L132 240 L204 206 L274 238 L342 212 L390 232 V360 H0Z" fill="#0f3b35" />
          <rect x="0" y="216" width="390" height="46" fill="url(#tm-pines)" opacity="0.9" />
          <rect x="0" y="130" width="390" height="670" fill="url(#tm-fade)" />
        </svg>
      )}
    </div>
  );
}
