import { formatDistance } from "@/lib/live";
import { googleMapsDirections, googleMapsPlace } from "@/lib/maps-links";
import { KIND_META, type PoiKind } from "@/lib/poi/types";
import type { OpenStatus } from "@/lib/intel/hours";
import { PulseCard } from "./PulseCard";
import { AboutPlace } from "@/components/place/AboutPlace";
import { Glyph, KindBadge } from "@/components/ui/Glyph";
import type { PoiPhoto } from "@/lib/intel/poi-media";
import { SafeImg } from "@/components/ui/SafeImg";

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
  const chip = "rounded-full bg-sky px-2.5 py-1 text-xs font-semibold text-ink-muted";
  return (
    <li className="py-2 text-sm">
      <div className="rounded-2xl border border-line bg-white p-3">
        <div className="flex gap-3">
          {photo ? (
            <SafeImg src={photo.url} srcSet={photo.srcSet} sizes="64px" alt={`Photo of ${name}`} width={64} height={64} className="h-16 w-16 shrink-0 rounded-2xl object-cover" fallback={<KindBadge kind={kind} size={64} />} />
          ) : (
            <KindBadge kind={kind} size={64} />
          )}
          <div className="min-w-0 flex-1">
            <p className="break-words text-base font-semibold leading-snug text-pine">{name}</p>
            <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-teal-ink">{k.label}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className={chip}>{etaMin < 1 ? "Just ahead" : `${etaMin} min ahead`}</span>
              <span className={chip}>{detourMin > 0 ? `${detourMin} min detour` : "On your road"}</span>
              <span className={chip}>{aheadKm < 1 ? "<1 km" : formatDistance(aheadKm)}</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${open.state === "open" ? "bg-teal-light text-teal-ink" : open.state === "closed" ? "bg-clay-light text-clay-ink" : "bg-sky text-ink-muted"}`}>{openText(open)}</span>
            </div>
          </div>
        </div>
        {note && <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-marigold-light px-3 py-1.5 text-xs font-semibold text-marigold-ink"><Glyph name="sun" size={13} />{note}</p>}
        {photo?.creditUrl && <p className="mt-1.5 text-[11px] text-ink-muted"><a href={photo.creditUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{photo.licence ? "Photo credit" : "Photo: Wikimedia"}<span className="sr-only"> (opens in a new tab)</span></a></p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a href={googleMapsDirections({ lat, lng })} target="_blank" rel="noopener noreferrer" className="tm-action-solid">
            <Glyph name="navigate" size={16} />Navigate<span className="sr-only"> to {name} in Google Maps (opens in a new tab)</span>
          </a>
          {children}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <a href={googleMapsPlace({ lat, lng })} target="_blank" rel="noopener noreferrer" className="tm-action-quiet !px-2.5">
            <Glyph name="external" size={15} />Maps<span className="sr-only"> for {name} (opens in a new tab)</span>
          </a>
          {(kind === "sight" || kind === "viewpoint") && <AboutPlace place={{ name, lat, lng, category: radarCategory(kind), hours }} className="tm-action-quiet !px-2.5" label="About" />}
          <PulseCard name={name} lat={lat} lng={lng} hours={hours} hoursCheckedAt={fetchedAt} />
        </div>
      </div>
    </li>
  );
}

/** Only sights and viewpoints get an About button (food, fuel, restrooms have nothing to read about); a viewpoint also gets its general tips. */
const radarCategory = (kind: PoiKind): string | null => (kind === "viewpoint" ? "viewpoint" : null);
