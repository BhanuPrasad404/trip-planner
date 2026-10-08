import type { PlacePhoto as Photo } from "@/lib/place-photos";

type Props = {
  photo?: Photo | null;
  name: string;
  /** Shown when there is no photo — never a stand-in picture. */
  fallback: React.ReactNode;
  className?: string;
  /** Show the Wikipedia credit under the image (compact lists can leave it to a tooltip + link). */
  credit?: boolean;
};

/** A real photo of the place with its credit, or the category icon. Fixed box so nothing jumps when the photo arrives. */
export function PlacePhoto({ photo, name, fallback, className = "h-16 w-16", credit = false }: Props) {
  if (!photo) return <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-xl bg-teal-light text-teal-ink ${className}`}>{fallback}</span>;
  return (
    <span className={`relative block shrink-0 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia thumbnail (480px), lazy-loaded, fixed size */}
      <img src={photo.url} alt={`Photo of ${name}`} width={photo.width} height={photo.height} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full rounded-xl object-cover" />
      {credit ? (
        <a href={photo.pageUrl} target="_blank" rel="noopener noreferrer" className="absolute inset-x-0 bottom-0 truncate rounded-b-xl bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
          Wikipedia<span className="sr-only"> — photo credit (opens in a new tab)</span>
        </a>
      ) : null}
    </span>
  );
}
