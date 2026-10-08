"use client";

import { useEffect, useRef, useState } from "react";
import { createProgressTracker, type ProgressEvent } from "@/lib/client/video-progress";
import { MutedIcon, PlayIcon, SoundIcon } from "./icons";

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
};

export function FeedVideo({ src, poster, width, height, active, near, frugal, muted, onToggleMute, onPlay, onProgress }: Props) {
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

  // Only the visible video plays; every other video is paused the moment it leaves the screen.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active && !frugal && !failed) {
      v.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));          // browsers may refuse autoplay: show a Play button instead
    } else {
      v.pause();
    }
  }, [active, frugal, failed, attempt]);

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
        className="h-full w-full object-cover"
        onPlaying={() => { setBuffering(false); if (!startedOnce.current) { startedOnce.current = true; onPlay(); } }}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onTimeUpdate={(e) => tracker.current?.update(e.currentTarget.currentTime, e.currentTarget.duration)}
        onError={() => setFailed(true)}
      />
      {buffering && active && <div className="absolute inset-0 flex items-center justify-center" role="status" aria-label="Buffering"><span className="h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white" /></div>}

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
        <button type="button" onClick={onToggleMute} aria-label={muted ? "Turn sound on" : "Turn sound off"} aria-pressed={!muted}
          className="absolute left-3 top-14 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur">
          {muted ? <MutedIcon size={20} /> : <SoundIcon size={20} />}
        </button>
      )}
    </div>
  );
}
