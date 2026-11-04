"use client";

// A mosaic of famous places with their REAL photos (Wikipedia / Wikimedia Commons, verified licence, author credited on each).
// The photos arrive a moment after the page (so the page never waits for them); until then, and for any place without a verified photo,
// a designed tile shows the name. Nothing here is a stock image.
import { Reveal } from "./Motion";
import { useLandingPhotos } from "./useLandingPhotos";
import { Glyph } from "@/components/ui/Glyph";
import { SafeImg } from "@/components/ui/SafeImg";
import { DESTINATIONS } from "@/lib/landing-content";
import { creditText } from "@/lib/place-photos/safety";

export function Destinations() {
  const photos = useLandingPhotos();
  return (
    <ul className="grid auto-rows-[11rem] grid-cols-2 gap-3 sm:auto-rows-[13rem] sm:gap-4 lg:grid-cols-4">
      {DESTINATIONS.map((d, i) => {
        const p = photos[d.key];
        const big = i === 0;
        return (
          <Reveal as="li" key={d.key} delay={(i % 4) * 90} className={`group relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal to-pine ${big ? "col-span-2 row-span-2" : ""}`}>
            {p ? (
              <SafeImg src={p.url} srcSet={p.srcSet} sizes={big ? "(min-width: 1024px) 50vw, 96vw" : "(min-width: 1024px) 25vw, 48vw"} alt={`Photo of ${d.name}`} width={p.width} height={p.height}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-110" fallback={<Tile />} />
            ) : <Tile />}
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-pine/85 via-pine/10 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-3.5 text-white sm:p-4">
              <span className="inline-block rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur">{d.kind}</span>
              <p className={`mt-1 break-words font-display font-semibold leading-tight ${big ? "text-2xl sm:text-3xl" : "text-lg"}`}>{d.name}</p>
              <p className="text-xs text-white/80">{d.where}</p>
              {p?.creditUrl && <a href={p.creditUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-[10px] text-white/60 underline-offset-2 hover:underline">{p.licence ? creditText(p) : "Photo: Wikimedia"}<span className="sr-only"> (opens in a new tab)</span></a>}
            </div>
          </Reveal>
        );
      })}
    </ul>
  );
}

function Tile() {
  return <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-white/25"><Glyph name="compass" size={72} strokeWidth={1.2} /></span>;
}
