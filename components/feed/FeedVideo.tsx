"use client";

import { Spinner } from "@/components/ui/Spinner";
import { useEffect, useRef, useState } from "react";
import { createProgressTracker, type ProgressEvent } from "@/lib/client/video-progress";
import { reportMediaFailure } from "@/lib/client/media-report";
import { MutedIcon, PauseIcon, PlayIcon, SoundIcon } from "./icons";

type Props = {
  src: string;
  poster: string | null;
  width: number | null;
  height: number | null;
  /** The one video the person is looking at. Only this one plays. */
  active: boolean;
  /** Neighbours of the active card: allowed to fetch a little (metadata) so the swipe feels instant. Everything else downloads nothing. */
  near: boolean;
  /** On a slow connection or Data Saver: never autoplay or preload, show the poster with a Play button. */
  frugal: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onPlay: () => void;
  onProgress: (e: ProgressEvent) => void;
  /** "cover" fills a card; "contain" shows the whole video (the post page). */
  fit?: "cover" | "contain";
  /** For the failure report only. */
  postId?: string;
  /** The video failed: ask for fresh links (old ones expire). Resolves true when there is a new link to try. */
  onExpired?: () => Promise<boolean>;
};

export function FeedVideo({ src, poster, width, height, active, near, frugal, muted, onToggleMute, onPlay, onProgress, fit = "cover", postId = "?", onExpired }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const progress = useRef(onProgress);
  useEffect(() => { progress.current = onProgress; });
  const tracker = useRef<ReturnType<typeof createProgressTracker> | null>(null);
  useEffect(() => { tracker.current = createProgressTracker((e) => progress.current(e)); }, []);
  const startedOnce = useRef(false);
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(false);
  const triedFresh = useRef(false);                        // the person paused it: it stays paused until they press play or scroll away
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) { setWasActive(active); if (!active) setPaused(false); }       // scrolled away: next time it plays again

  // Only the visible video plays; every other video is paused the moment it leaves the screen.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active && !frugal && !failed && !paused) {
      v.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));          // browsers may refuse autoplay: show a Play button instead
    } else {
      v.pause();
    }
  }, [active, frugal, failed, attempt, paused]);

  // Far-away videos hold no network connection and no buffer at all.
  const loadSrc = (active || near) && !failed;

  return (
    <div className="absolute inset-0 bg-black">
      <video
        key={attempt}
        ref={ref}
        src={loadSrc ? src : undefined}
        poster={poster ?? undefined}
        width={width ?? undefined}
        height={height ?? undefined}
        muted={muted}
        loop
        playsInline
        preload={active ? (frugal ? "metadata" : "auto") : near && !frugal ? "metadata" : "none"}
        className={`h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
        onPlaying={() => { setBuffering(false); if (!startedOnce.current) { startedOnce.current = true; onPlay(); } }}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onTimeUpdate={(e) => tracker.current?.update(e.currentTarget.currentTime, e.currentTarget.duration)}
        onError={() => {
          const giveUp = () => { setFailed(true); reportMediaFailure("video", src, postId); };
          if (onExpired && !triedFresh.current) { triedFresh.current = true; setBuffering(true); void onExpired().then((ok) => { setBuffering(false); if (!ok) giveUp(); }); }   // a new link arrives as a new src
          else giveUp();
        }}
      />
      {buffering && active && <div className="absolute inset-0 flex items-center justify-center" role="status" aria-label="Buffering"><Spinner size={40} className="text-white" /></div>}

      {(needsTap || (frugal && active)) && !failed && (
        <button type="button" onClick={() => { void ref.current?.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true)); }}
          className="absolute inset-0 flex items-center justify-center bg-black/30 text-white" aria-label="Play video">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 backdrop-blur"><PlayIcon size={30} /></span>
        </button>
      )}

      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center text-white" role="alert">
          <p className="text-sm font-semibold">This video couldn&apos;t load.</p>
          <button type="button" onClick={() => { setFailed(false); setAttempt((n) => n + 1); }} className="min-h-11 rounded-full bg-white px-5 text-sm font-semibold text-pine">Try again</button>
        </div>
      )}

      {active && !failed && (
        <div className="absolute bottom-3 left-3 flex gap-2">
          <button type="button" onClick={onToggleMute} aria-label={muted ? "Turn sound on" : "Turn sound off"} aria-pressed={!muted}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur">
            {muted ? <MutedIcon size={20} /> : <SoundIcon size={20} />}
          </button>
          {!frugal && !needsTap && (
            <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play video" : "Pause video"} aria-pressed={paused}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur">
              {paused ? <PlayIcon size={20} /> : <PauseIcon size={20} />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
