import Image from "next/image";
import heroPhoto from "@/public/brand/mobile-hero.webp";

/**
 * The scene behind the whole app on phones: a real photograph (self-hosted in /public/brand, optimised by next/image: sized for the
 * phone, modern formats, a blurred placeholder while it loads), fading into deep forest green so every card and every line of text sits
 * on a dark, calm surface. Nothing moves. Hidden from screen readers and never catches a tap. Not shown from 768 px up.
 * Set HERO_PHOTO to null to go back to the drawn scene below (no image download at all).
 */
export const HERO_PHOTO: string | null = "/brand/mobile-hero.webp";
/** Who took the photo and under which licence, shown in the app (lib/legal-content / profile). Null until the owner confirms it. */
export const HERO_CREDIT: string | null = null;

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
        <>
          <Image src={heroPhoto} alt="" fill priority sizes="768px" placeholder={typeof heroPhoto === "object" && heroPhoto.blurDataURL ? "blur" : "empty"} quality={70} className="object-cover object-top" />
          {/* Dark at the top (under the header), clear through the view, then into the forest green the cards sit on. */}
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, rgba(6,32,28,0.55) 0%, rgba(6,32,28,0.05) 18%, rgba(6,32,28,0.15) 38%, ${BACKDROP_COLORS.ground} 72%)` }} />
        </>
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
