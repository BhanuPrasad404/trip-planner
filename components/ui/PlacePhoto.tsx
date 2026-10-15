"use client";

import type { PlacePhoto as Photo } from "@/lib/place-photos";
import { creditText } from "@/lib/place-photos/safety";
import { SafeImg } from "./SafeImg";

type Props = {
  photo?: Photo | null;
  name: string;
  /** Shown when there is no photo, or the photo fails to load — never a stand-in picture. */
  fallback: React.ReactNode;
  className?: string;
  /** Show the author + licence credit under the image (compact lists can leave it to the link on the photo page). */
  credit?: boolean;
  /** Rendered width in CSS px, so the browser picks the right file from srcSet. */
  sizes?: string;
};

const tile = (className: string, fallback: React.ReactNode) => (
  <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-xl bg-teal-light text-teal-ink ${className}`}>{fallback}</span>
);

/** A real photo of the place with its credit, or the category icon. Fixed box so nothing jumps when the photo arrives. */
export function PlacePhoto({ photo, name, fallback, className = "h-16 w-16", credit = false, sizes = "96px" }: Props) {
  if (!photo) return tile(className, fallback);
  const text = photo.licence ? creditText(photo) : "Wikipedia";
  return (
    <span className={`relative block shrink-0 ${className}`}>
      <SafeImg
        src={photo.url} srcSet={photo.srcSet} sizes={sizes} alt={`Photo of ${name}`} width={photo.width} height={photo.height}
        className="h-full w-full rounded-xl object-cover" fallback={tile("h-full w-full", fallback)}
      >
        {credit ? (
          <a href={photo.creditUrl ?? photo.pageUrl} target="_blank" rel="noopener noreferrer" title={text} className="absolute inset-x-0 bottom-0 truncate rounded-b-xl bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
            {text}<span className="sr-only"> — photo credit (opens in a new tab)</span>
          </a>
        ) : null}
      </SafeImg>
    </span>
  );
}

/** One small credit line ("Photo: Jane Doe, CC BY-SA 4.0") linking to the page that shows the full author and licence. */
export function PhotoCredit({ photo, className = "" }: { photo: Photo; className?: string }) {
  const text = photo.licence ? creditText(photo) : "Photo: Wikipedia";
  return (
    <a href={photo.creditUrl ?? photo.pageUrl} target="_blank" rel="noopener noreferrer" className={`block truncate text-[11px] text-ink-muted underline underline-offset-2 ${className}`}>
      {text}<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
