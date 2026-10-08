"use client";

import { useEffect, useRef, useState } from "react";
import { useCamera } from "@/lib/client/use-camera";
import { captureHints, formatClock, formatLimit, MAX_RECORD_MS, type CameraMode } from "@/lib/client/recorder";
import { CloseIcon, PlayIcon, UploadIcon } from "../icons";

type Props = {
  initialMode: CameraMode;
  /** Hands the finished photo/video to the SAME pipeline as a file chosen from the device. */
  onUse: (file: File) => void;
  onClose: () => void;
  /** "Choose from device instead" — shown when the camera cannot be used. */
  onUpload: () => void;
};

const RING = 2 * Math.PI * 34;

function SwitchIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h3M20 16v2a2 2 0 0 1-2 2h-3M9 4l-2 2 2 2M15 20l2-2-2-2" /><path d="M5 11a7 7 0 0 1 14 0M19 13a7 7 0 0 1-14 0" opacity=".55" /></svg>;
}
const PauseIcon = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>;

export function CameraCapture({ initialMode, onUse, onClose, onUpload }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cam = useCamera(initialMode, videoRef);
  const { state } = cam;
  const [confirm, setConfirm] = useState<null | "recording" | "review">(null);
  const recording = state.phase === "recording" || state.phase === "paused";

  const requestClose = () => {
    if (recording) setConfirm("recording");
    else if (state.phase === "review") setConfirm("review");
    else onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (recording) setConfirm("recording"); else if (state.phase === "review") setConfirm("review"); else onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [recording, state.phase, onClose]);

  function use() {
    const c = state.capture;
    if (!c) return;
    const ext = c.kind === "photo" ? "jpg" : c.mime === "video/mp4" ? "mp4" : "webm";
    const file = new File([c.blob], `trailmate-${Date.now()}.${ext}`, { type: c.mime });
    if (c.kind === "video") captureHints.set(file, { durationS: c.durationMs / 1000 });
    onUse(file);
  }

  const progress = Math.min(1, state.elapsedMs / MAX_RECORD_MS);
  const frontCamera = state.facing === "user";
  const review = state.phase === "review" && state.capture;

  return (
    <div role="dialog" aria-modal="true" aria-label={state.mode === "photo" ? "Take a photo" : "Record a video"} className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* live camera (kept mounted so the stream can attach) */}
        <video ref={videoRef} muted playsInline autoPlay aria-hidden={!!review} className={`absolute inset-0 h-full w-full object-cover ${frontCamera ? "-scale-x-100" : ""} ${review ? "invisible" : ""}`} />

        {review && state.capture!.kind === "photo" && (
          // eslint-disable-next-line @next/next/no-img-element -- local blob preview of the photo just taken
          <img src={state.capture!.url} alt="The photo you just took" className="absolute inset-0 h-full w-full bg-black object-contain" />
        )}
        {review && state.capture!.kind === "video" && (
          <video key={state.capture!.url} src={state.capture!.url} controls playsInline autoPlay loop aria-label="Preview of the video you just recorded" className="absolute inset-0 h-full w-full bg-black object-contain" />
        )}

        {recording && <div className="absolute inset-x-0 top-0 h-1.5 bg-white/20" aria-hidden="true"><div className="h-full bg-red-500 transition-[width] duration-100" style={{ width: `${progress * 100}%` }} /></div>}

        {/* top bar */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-gradient-to-b from-black/60 to-transparent p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <button type="button" onClick={requestClose} aria-label="Close camera" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 backdrop-blur"><CloseIcon size={22} /></button>
          {(recording || (state.phase === "live" && state.mode === "video")) && (
            <div role="timer" aria-label={`Recorded ${formatClock(state.elapsedMs)} of ${formatLimit()}`} className="flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 font-mono text-sm font-semibold tabular-nums backdrop-blur">
              <span className={`h-2.5 w-2.5 rounded-full ${state.phase === "recording" ? "animate-pulse bg-red-500" : state.phase === "paused" ? "bg-marigold" : "bg-white/50"}`} aria-hidden="true" />
              {formatClock(state.elapsedMs)} / {formatLimit()}{state.phase === "paused" && <span className="text-marigold"> · paused</span>}
            </div>
          )}
          {state.canSwitch && state.phase === "live" ? (
            <button type="button" onClick={cam.switchFacing} aria-label="Switch camera" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 backdrop-blur"><SwitchIcon /></button>
          ) : <span className="h-11 w-11" aria-hidden="true" />}
        </div>

        {state.phase === "starting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black" role="status"><span className="h-10 w-10 animate-spin rounded-full border-4 border-white/25 border-t-white" /><p className="text-sm text-white/80">Starting camera…</p></div>
        )}

        {state.phase === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black px-8 text-center" role="alert">
            <p className="max-w-sm text-base leading-relaxed">{state.error}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <button type="button" onClick={() => void cam.reopen()} className="min-h-12 rounded-full bg-white px-6 text-sm font-semibold text-pine">Try again</button>
              <button type="button" onClick={onUpload} className="inline-flex min-h-12 items-center gap-2 rounded-full border border-white/40 px-6 text-sm font-semibold"><UploadIcon size={18} />Upload from device</button>
            </div>
          </div>
        )}

        {state.notice && state.phase !== "starting" && state.phase !== "error" && (
          <p role="status" className="absolute inset-x-4 top-20 rounded-2xl bg-black/65 px-4 py-2.5 text-center text-sm backdrop-blur">{state.notice}</p>
        )}

        {confirm && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-6">
            <div role="alertdialog" aria-modal="true" aria-labelledby="cam-discard" className="tm-pop w-full max-w-sm rounded-3xl bg-white p-6 text-center text-ink shadow-2xl">
              <h3 id="cam-discard" className="font-display text-xl font-semibold text-pine">{confirm === "recording" ? "Discard this recording?" : `Discard this ${state.capture?.kind ?? "clip"}?`}</h3>
              <p className="mt-1.5 text-sm text-ink-muted">{confirm === "recording" ? "What you've recorded so far will be lost." : "You can also retake it, or use it."}</p>
              <div className="mt-5 flex flex-col gap-2.5">
                <button type="button" autoFocus onClick={() => setConfirm(null)} className="min-h-12 rounded-full bg-teal text-sm font-semibold text-white">{confirm === "recording" ? "Keep recording" : "Keep it"}</button>
                <button type="button" onClick={onClose} className="min-h-12 rounded-full text-sm font-semibold text-clay-ink hover:bg-clay-light">Discard</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* controls */}
      <div className="shrink-0 bg-black px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
        {state.phase === "live" && (
          <div className="flex flex-col items-center gap-4">
            <div role="tablist" aria-label="Camera mode" className="flex gap-1 rounded-full bg-white/10 p-1 text-sm font-semibold">
              {(["photo", "video"] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={state.mode === m} onClick={() => cam.setMode(m)} className={`min-h-10 rounded-full px-5 transition-colors ${state.mode === m ? "bg-white text-black" : "text-white/75"}`}>{m === "photo" ? "Photo" : "Video"}</button>
              ))}
            </div>
            {state.mode === "photo" ? (
              <button type="button" onClick={cam.takePhoto} aria-label="Take photo" className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white active:scale-95 transition-transform"><span className="h-14 w-14 rounded-full bg-white" /></button>
            ) : (
              <button type="button" onClick={cam.startRecording} aria-label="Start recording" className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white active:scale-95 transition-transform"><span className="h-14 w-14 rounded-full bg-red-500" /></button>
            )}
            <p className="text-xs text-white/60">{state.mode === "video" ? `Up to ${formatLimit().slice(3)} seconds. Stop whenever you like.` : "Tap to take a photo"}</p>
          </div>
        )}

        {recording && (
          <div className="flex items-center justify-between">
            <div className="w-16">
              {state.canPause && (state.phase === "recording"
                ? <button type="button" onClick={cam.pause} aria-label="Pause recording" className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15"><PauseIcon /></button>
                : <button type="button" onClick={cam.resume} aria-label="Resume recording" className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-marigold"><PlayIcon size={22} /></button>)}
            </div>
            <button type="button" onClick={() => cam.stopRecording("user")} aria-label={`Stop recording (${formatClock(state.elapsedMs)} recorded)`} className="relative flex h-[84px] w-[84px] items-center justify-center active:scale-95 transition-transform">
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="34" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="5" /><circle cx="38" cy="38" r="34" fill="none" stroke="#ef4444" strokeWidth="5" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING * (1 - progress)} /></svg>
              <span className="h-8 w-8 rounded-md bg-red-500" />
            </button>
            <p className="w-16 text-right text-xs text-white/60">Tap to stop</p>
          </div>
        )}

        {review && (
          <div className="flex flex-col items-center gap-3.5">
            <p className="font-semibold" aria-live="polite">{state.capture!.kind === "video" ? `Video ready — ${formatClock(state.capture!.durationMs)}` : "Photo ready"}</p>
            <div className="flex w-full max-w-md gap-3">
              <button type="button" onClick={cam.retake} className="min-h-12 flex-1 rounded-full border border-white/40 text-sm font-semibold">Retake</button>
              <button type="button" onClick={use} className="min-h-12 flex-[1.4] rounded-full bg-marigold text-sm font-semibold text-pine active:scale-95 transition-transform">{state.capture!.kind === "video" ? "Use video" : "Use photo"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
