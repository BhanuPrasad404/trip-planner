"use client";

// A full-bleed backdrop made of REAL photographs (Wikimedia Commons, credited): they cross-fade slowly, each drifting in a gentle zoom, under
// a dark wash that keeps text readable. Before the photos arrive, or if they never do, the section is simply the plain dark ground: nothing
// is generated, nothing breaks. For reduced motion: one still photo.
import { useEffect, useState } from "react";
import { biggerThumb, useLandingPhotos } from "./useLandingPhotos";
import { creditText } from "@/lib/place-photos/safety";
import type { PlacePhoto } from "@/lib/place-photos";

const SLIDE_MS = 7000;

function Slide({ photo, active }: { photo: PlacePhoto; active: boolean }) {
  // The widest standard size the screen can use; any size that cannot be made (a smaller original) falls back to the next one down, then the small one.
  const sizes = typeof window !== "undefined" && window.innerWidth < 800 ? [960, 500] : [1920, 1280, 960];
  const [step, setStep] = useState(0);
  const src = step < sizes.length ? biggerThumb(photo.url, sizes[step]) : photo.url;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a remote Commons photo that must fall back to its small version on any error
    <img src={src} alt="" aria-hidden="true" loading={active ? "eager" : "lazy"} decoding="async" onError={() => setStep((n) => Math.min(n + 1, sizes.length))}
      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1600ms] ease-in-out ${active ? "tm-kenburns opacity-100" : "opacity-0"}`} />
  );
}

/** `keys`: which of the landing photos to use, in order. `side`: where the text sits, so the wash is darkest there. */
export function PhotoBackdrop({ keys, side = "left", className = "" }: { keys: readonly string[]; side?: "left" | "center"; className?: string }) {
  const photos = useLandingPhotos();
  const slides = keys.map((k) => photos[k]).filter((p): p is PlacePhoto => !!p);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (slides.length < 2 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => { if (!document.hidden) setI((n) => n + 1); }, SLIDE_MS);
    return () => window.clearInterval(t);
  }, [slides.length]);

  const active = slides.length ? i % slides.length : 0;
  const now = slides[active];
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden bg-ink ${className}`}>
      {slides.map((p, n) => <Slide key={p.url} photo={p} active={n === active} />)}
      <div className={`absolute inset-0 ${side === "center" ? "bg-ink/70" : "bg-gradient-to-b from-ink/90 via-ink/75 to-ink/90 sm:bg-gradient-to-r sm:from-ink/95 sm:via-ink/75 sm:to-ink/25"}`} />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink/80 to-transparent" />
      {now?.creditUrl && (
        <a href={now.creditUrl} target="_blank" rel="noopener noreferrer" tabIndex={-1} className="pointer-events-auto absolute bottom-3 right-4 max-w-[70%] truncate text-[10px] text-white/55 underline-offset-2 hover:text-white/90 hover:underline sm:bottom-4 sm:right-6">
          {now.licence ? creditText(now) : "Photo: Wikimedia Commons"}
        </a>
      )}
    </div>
  );
}
