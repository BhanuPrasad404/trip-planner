import { formatDistance } from "@/lib/live";
import { googleMapsDirections, googleMapsPlace } from "@/lib/maps-links";
import { KIND_META, type PoiKind } from "@/lib/poi/types";
import type { OpenStatus } from "@/lib/intel/hours";
import { PulseCard } from "./PulseCard";
import { Glyph, KindBadge } from "@/components/ui/Glyph";
import type { PoiPhoto } from "@/lib/intel/poi-media";

type Props = {
  kind: PoiKind;
  name: string;
  lat: number;
  lng: number;
  etaMin: number;
  aheadKm: number;
  detourMin: number;
  open: OpenStatus;
  note?: string | null;
  hours?: string | null;
  fetchedAt?: string | null;
  /** The place's OWN photo (from its map entry). Never a nearby traveler's upload. */
  photo?: PoiPhoto;
  /** Extra buttons (e.g. "Go there"). */
  children?: React.ReactNode;
};

const openText = (o: OpenStatus) => (o.state === "open" ? `Open${o.at ? ` until ${o.at}` : ""}` : o.state === "closed" ? "Closed" : "Hours not listed");

/** One useful place AHEAD: how many minutes away, how much detour, and the Google Maps links people already trust. */
export function PlaceRow({ kind, name, lat, lng, etaMin, aheadKm, detourMin, open, note, hours, fetchedAt, photo, children }: Props) {
  const k = KIND_META[kind];
  return (
    <li className="flex gap-3 py-3 text-sm">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- the place's own Wikimedia photo, small thumbnail
        <img src={photo.url} alt={`Photo of ${name}`} width={56} height={56} loading="lazy" referrerPolicy="no-referrer" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
      ) : (
        <KindBadge kind={kind} size={56} />
      )}
      <div className="min-w-0 flex-1">
        <p className="break-words font-semibold text-pine">{name} <span className="font-normal text-ink-muted">· {k.label}</span></p>
        <p className="font-mono text-xs text-ink-muted">
          {etaMin < 1 ? "just ahead" : `${etaMin} min ahead`} · {detourMin > 0 ? `${detourMin} min detour` : "on your road"} · {aheadKm < 1 ? "<1 km" : formatDistance(aheadKm)}
        </p>
        <p className={`text-xs ${open.state === "open" ? "text-teal-ink" : open.state === "closed" ? "text-clay-ink" : "text-ink-muted"}`}>{openText(open)}{photo?.creditUrl && (<> · <a href={photo.creditUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Photo: Wikimedia<span className="sr-only"> (opens in a new tab)</span></a></>)}</p>
        {note && <p className="flex items-center gap-1 text-xs font-semibold text-[#7a4a00]"><Glyph name="sun" size={13} />{note}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <a href={googleMapsDirections({ lat, lng })} target="_blank" rel="noopener noreferrer" className="min-h-9 py-1.5 font-semibold text-teal-ink underline underline-offset-2">
            Navigate<span className="sr-only"> to {name} in Google Maps (opens in a new tab)</span>
          </a>
          <a href={googleMapsPlace({ lat, lng })} target="_blank" rel="noopener noreferrer" className="min-h-9 py-1.5 text-ink-muted underline underline-offset-2">
            Open in Google Maps<span className="sr-only"> (opens in a new tab)</span>
          </a>
          {children}
        </div>
        <PulseCard name={name} lat={lat} lng={lng} hours={hours} hoursCheckedAt={fetchedAt} />
      </div>
    </li>
  );
}
