import Image from "next/image";
import heroPhoto from "@/public/brand/trailmate-hills.webp";

/**
 * The scene behind the whole app (phones and desktop): the warm-white page with a faint real photograph at the very top (misty tea
 * hills at sunrise; self-hosted in /public/brand, optimised by next/image: sized for the phone, modern formats, a blurred placeholder
 * while it loads). A heavy warm-white wash lies over the photo and melts into the page colour, so it is atmosphere only: dark text
 * stays readable over any part of it, and everything below the first screen sits on plain warm white. Nothing moves. Hidden from
 * screen readers and never catches a tap.
 * Set HERO_PHOTO to null to go back to a plain dawn-tinted page (no image download at all).
 */
export const HERO_PHOTO: string | null = "/brand/trailmate-hills.webp";
/** Who took the photo and under which licence, shown in the app (lib/legal-content / profile). Null until the owner confirms it. */
export const HERO_CREDIT: string | null = null;

/** The scene's colours, kept together so they can be checked for readability (tests/mobile-theme.test.ts) and changed in one place. */
export const BACKDROP_COLORS = {
  /** The page colour the scene melts into (the --sky token). */
  ground: "#f5f2ea",
  /** The wash laid over the photo (warm white). */
  wash: "250, 248, 243",
  /** How opaque the wash is at the top of the page, where the header sits: the photo can add at most the rest. */
  topWash: 0.88,
} as const;

export function MobileBackdrop() {
  const { ground, wash, topWash } = BACKDROP_COLORS;
  return (
    <div aria-hidden="true" data-mobile-backdrop className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-sky">
      {HERO_PHOTO ? (
        <>
          <Image src={heroPhoto} alt="" fill priority sizes="(max-width: 767px) 768px, 1600px" placeholder={typeof heroPhoto === "object" && heroPhoto.blurDataURL ? "blur" : "empty"} quality={70} className="object-cover object-top" />
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, rgba(${wash},${topWash}) 0%, rgba(${wash},0.93) 20%, ${ground} 42%)` }} />
        </>
      ) : (
        <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, #fbe9c6 0%, ${ground} 40%)` }} />
      )}
    </div>
  );
}
