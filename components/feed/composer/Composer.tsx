"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prepareVideo, preparePhoto } from "@/lib/client/prepare-media";
import { useCameraSupport } from "@/lib/client/camera-support";
import { Fatal, transientStatus, withRetry } from "@/lib/client/retry";
import { captureHints, type CameraMode } from "@/lib/client/recorder";
import { blocker, capturedAtFor, canAddMore, postKindFor, STEPS, type ComposeStep, type PlaceChoice, type WhenId } from "@/lib/feed/compose";
import { MEDIA_LIMITS, POST_MEDIA_BUCKET } from "@/lib/social/media";
import { createClient } from "@/lib/supabase/client";
import { BackIcon, CloseIcon } from "../icons";
import { currentPosition } from "@/lib/client/position";
import { type CrowdLevel } from "@/lib/feed/experience";
import { CameraCapture } from "./CameraCapture";
import { ExperiencePicker } from "./ExperiencePicker";
import { DetailsStep } from "./DetailsStep";
import { MediaStep } from "./MediaStep";
import { PlaceStep } from "./PlaceStep";
import { PostPreview } from "./PostPreview";
import type { ComposerItem, Uploaded } from "./types";

const TITLES: Record<ComposeStep, { title: string; hint: string }> = {
  media: { title: "Add photos or a video", hint: "Real, recent and honest is what helps most." },
  place: { title: "Where was this?", hint: "So it shows up for people planning that trip." },
  details: { title: "Tell travelers more", hint: "A line or two is plenty." },
};

/** One file, straight to storage. Transient trouble (dropped connection, busy server) is retried; refusals are not. */
async function uploadOne(blob: Blob, mime: string, bytes: number): Promise<string> {
  return withRetry(async () => {
    let res: Response;
    try { res = await fetch("/api/posts/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mime, bytes }) }); }
    catch { throw new Error("No connection."); }
    const j = await res.json().catch(() => null);
    if (res.status === 409) throw new Fatal("Set up your traveler profile first.");
    if (!res.ok) { const e = new Error(j?.error ?? "Couldn't start the upload."); throw transientStatus(res.status) ? e : new Fatal(e.message); }
    const { error } = await createClient().storage.from(POST_MEDIA_BUCKET).uploadToSignedUrl(j.path, j.token, blob, { contentType: mime });
    if (error) {
      const status = Number((error as { statusCode?: string | number }).statusCode);
      const e = new Error("The upload didn't finish. Check your connection and try again.");
      throw Number.isFinite(status) && status >= 400 && status < 500 && !transientStatus(status) ? new Fatal(status === 413 ? "That file is too large to upload." : e.message) : e;
    }
    return j.path as string;
  });
}

type Phase = "edit" | "uploading" | "done";

export function Composer({ hasProfile, onClose, onPosted }: { hasProfile: boolean; onClose: () => void; onPosted: () => void }) {
  const [step, setStep] = useState<ComposeStep>("media");
  const [items, setItems] = useState<ComposerItem[]>([]);
  const [writtenOnly, setWrittenOnly] = useState(false);
  const [place, setPlace] = useState<PlaceChoice | null>(null);
  const [spot, setSpot] = useState("");
  const [caption, setCaption] = useState("");
  const [precision, setPrecision] = useState<"approx" | "exact">("approx");
  const [when, setWhen] = useState<WhenId>("now");
  const [crowd, setCrowd] = useState<CrowdLevel | null>(null);
  const [conditions, setConditions] = useState<string[]>([]);
  const [vibes, setVibes] = useState<string[]>([]);
  const [tip, setTip] = useState("");
  const [wantsArea, setWantsArea] = useState(false);
  const [phase, setPhase] = useState<Phase>("edit");
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [error, setError] = useState<{ message: string; needsProfile?: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraMode | null>(null);
  const cameraSupport = useCameraSupport();
  const finished = useRef(new Map<string, Uploaded>());          // uploads that completed survive a retry: nothing is sent twice
  const itemsRef = useRef<ComposerItem[]>([]);
  const dialog = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const media = useMemo(() => items.map((i) => ({ status: i.status, type: i.media?.type })), [items]);
  const state = useMemo(() => ({ items: media, writtenOnly, place, caption }), [media, writtenOnly, place, caption]);
  const stop = blocker(step, state) ?? (step === "details" && !hasProfile ? "Set up your traveler profile to share" : null);
  const dirty = items.length > 0 || writtenOnly || place !== null || caption.trim() !== "" || spot.trim() !== "" || crowd !== null || conditions.length > 0 || vibes.length > 0 || tip.trim() !== "";
  const preview = items.find((i) => i.preview)?.preview ?? null;
  const cover = items[0]?.media;

  const requestClose = useCallback(() => {
    if (phase === "uploading") return;
    if (phase === "edit" && dirty) setConfirmDiscard(true); else onClose();
  }, [phase, dirty, onClose]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => {                                       // leaving mid-upload would lose the post: ask first
    if (phase !== "uploading") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [step, phase]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !camera) requestClose(); };    // while the camera is open, Escape belongs to it
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose, camera]);

  const addFiles = useCallback(async (list: FileList | File[] | null) => {
    if (!list || phase !== "edit") return;
    setError(null); setNotice(null); setWrittenOnly(false);
    // Track what has been accepted so far in THIS drop, so several files at once are counted correctly.
    const accepted = itemsRef.current.map((i) => ({ status: i.status, type: i.media?.type ?? (/\.(mp4|webm|mov)$/i.test(i.name) ? ("video" as const) : ("image" as const)) }));
    for (const file of Array.from(list)) {
      const isVideo = file.type.startsWith("video/");
      const id = crypto.randomUUID();
      if (isVideo && accepted.length > 0) { setNotice("Add one video on its own, or up to 4 photos — not both."); continue; }
      if (!isVideo && !canAddMore(accepted)) { setNotice(`You can add up to ${MEDIA_LIMITS.mediaPerPost} photos, or one video.`); continue; }
      accepted.push({ status: "ready", type: isVideo ? "video" : "image" });
      setItems((cur) => [...cur, { id, name: file.name, status: "preparing" }]);
      try {
        const m = isVideo ? await prepareVideo(file, captureHints.get(file)?.durationS) : await preparePhoto(file);
        setItems((cur) => cur.map((i) => (i.id === id ? { ...i, status: "ready", media: m, preview: URL.createObjectURL(m.poster?.blob ?? m.blob) } : i)));
      } catch (e) {
        setItems((cur) => cur.map((i) => (i.id === id ? { ...i, status: "error", error: e instanceof Error ? e.message : "Couldn't use that file." } : i)));
      }
    }
  }, [phase]);

  function removeItem(id: string) {
    setItems((cur) => { const it = cur.find((i) => i.id === id); if (it?.preview) URL.revokeObjectURL(it.preview); return cur.filter((i) => i.id !== id); });
    finished.current.delete(id); setNotice(null);
  }
  const makeCover = (id: string) => setItems((cur) => { const it = cur.find((i) => i.id === id); return it ? [it, ...cur.filter((i) => i.id !== id)] : cur; });

  async function submit() {
    if (stop || !place) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setError({ message: "You're offline. Reconnect and press Share again — everything you added is still here." }); return; }
    if (tip.trim() && tip.trim().length < 3) { setError({ message: "A tip needs a few words — or clear it." }); return; }
    setPhase("uploading"); setError(null);
    const total = items.length + 1;
    try {
      const uploaded = [] as { storage_path: string; poster_path: string | null; media_type: "image" | "video"; mime: string; bytes: number; width: number; height: number; duration_s: number | null }[];
      let n = 0;
      for (const it of items) {
        const m = it.media!;
        setProgress({ done: n, total, label: items.length > 1 ? `Uploading ${n + 1} of ${items.length}…` : m.type === "video" ? "Uploading your video…" : "Uploading your photo…" });
        let up = finished.current.get(it.id);
        if (!up) {
          const path = await uploadOne(m.blob, m.mime, m.blob.size);
          const posterPath = m.poster ? await uploadOne(m.poster.blob, m.poster.mime, m.poster.blob.size).catch(() => null) : null;   // a missing poster is fine
          up = { path, posterPath };
          finished.current.set(it.id, up);
        }
        uploaded.push({ storage_path: up.path, poster_path: up.posterPath, media_type: m.type, mime: m.mime, bytes: m.blob.size, width: m.width, height: m.height, duration_s: m.durationS });
        n++;
      }
      setProgress({ done: n, total, label: "Publishing…" });
      const here = wantsArea ? await currentPosition() : null;                    // asked for only because the person ticked the box
      const res = await fetch("/api/posts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: postKindFor(media), caption: caption.trim() || null, place_name: spot.trim() || place.name, destination_name: place.name,
          lat: place.lat, lng: place.lng, location_precision: precision, captured_at: capturedAtFor(when),
          visibility: "public", comments_allowed: "everyone", media: uploaded,
          crowd, conditions, vibes, tip: tip.trim() || null,
          ...(here ? { device_lat: here.lat, device_lng: here.lng } : {}),
        }),
      });
      const j = await res.json().catch(() => null);
      if (res.status === 409) throw Object.assign(new Error("Set up your traveler profile first."), { needsProfile: true });
      if (!res.ok) throw new Error(j?.error ?? "Couldn't publish. Please try again.");
      setProgress({ done: total, total, label: "Done" });
      setPhase("done");
      onPosted();
    } catch (e) {
      const err = e as Error & { needsProfile?: boolean };
      setError({ message: err.message || "Something went wrong. Please try again.", needsProfile: err.needsProfile });
      setPhase("edit");                                  // everything typed is still here, and finished uploads are kept
    }
  }

  function reset() {
    items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
    finished.current.clear();
    setItems([]); setWrittenOnly(false); setPlace(null); setSpot(""); setCaption(""); setPrecision("approx"); setWhen("now");
    setCrowd(null); setConditions([]); setVibes([]); setTip(""); setWantsArea(false);
    setError(null); setNotice(null); setPhase("edit"); setStep("media");
  }

  const next = () => {
    if (stop) return;
    if (step === "media") setStep("place"); else if (step === "place") setStep("details"); else void submit();
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-black/65 backdrop-blur-sm md:items-center md:justify-center md:p-6" onClick={requestClose}>
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="composer-title" onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => { if (step === "media" && phase === "edit") { e.preventDefault(); setDragging(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (step === "media") void addFiles(e.dataTransfer.files); }}
        onPaste={(e) => { const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/")); if (files.length && step === "media") { e.preventDefault(); void addFiles(files); } }}
        className="relative flex h-full w-full flex-col overflow-hidden bg-white outline-none md:h-[min(90dvh,780px)] md:max-w-[56rem] md:flex-row md:rounded-[32px] md:shadow-2xl">

        {/* ── live preview (wide screens) ─────────────────────── */}
        <aside className="relative hidden w-[21rem] shrink-0 flex-col items-center justify-center gap-4 overflow-hidden bg-gradient-to-b from-pine via-[#0e3a37] to-[#0a2625] p-6 md:flex">
          <div aria-hidden="true" className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-teal/25 blur-3xl" />
          <p className="relative text-xs font-semibold uppercase tracking-[0.2em] text-white/60">Live preview</p>
          <div className="relative flex w-full justify-center">
            <PostPreview imageUrl={preview} destination={place?.name ?? null} spot={spot} caption={caption} capturedAt={capturedAtFor(when)} precision={precision} isVideo={cover?.type === "video"} photoCount={items.filter((i) => i.media?.type === "image").length} />
          </div>
          <p className="relative max-w-[16rem] text-center text-xs text-white/60">This is how travelers will see it in Discover.</p>
        </aside>

        {/* ── the flow ───────────────────────────────────────── */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="shrink-0 px-5 pb-3 pt-4 md:px-7 md:pt-6">
            <div className="flex items-center gap-2" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={stepIndex + 1} aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`}>
              {STEPS.map((s, i) => <span key={s.id} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i <= stepIndex || phase === "done" ? "bg-teal" : "bg-line"}`} />)}
            </div>
            <div className="mt-4 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                {stepIndex > 0 && phase === "edit" && <button type="button" onClick={() => setStep(STEPS[stepIndex - 1].id)} aria-label="Back" className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-sky"><BackIcon size={22} /></button>}
                <div className="min-w-0">
                  <h2 id="composer-title" className="font-display text-2xl font-semibold leading-tight text-pine md:text-[1.7rem]">{phase === "done" ? "Shared" : phase === "uploading" ? "Sharing…" : TITLES[step].title}</h2>
                  {phase === "edit" && <p className="mt-0.5 text-sm text-ink-muted">{TITLES[step].hint}</p>}
                </div>
              </div>
              <button type="button" onClick={requestClose} disabled={phase === "uploading"} aria-label="Close" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-sky disabled:opacity-40"><CloseIcon size={22} /></button>
            </div>
            <p className="sr-only" aria-live="polite">{phase === "edit" ? `Step ${stepIndex + 1} of ${STEPS.length}: ${TITLES[step].title}` : ""}</p>
          </header>

          <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2 md:px-7">
            {!hasProfile && phase === "edit" && (
              <p className="mb-4 rounded-2xl bg-marigold-light px-4 py-3 text-sm text-[#7a4a00]">
                Pick a username before you share. <Link href="/profile" className="font-semibold underline">Open profile</Link> — your drafts here stay put.
              </p>
            )}
            {notice && <p role="status" className="mb-4 rounded-2xl bg-sky px-4 py-3 text-sm text-ink-muted">{notice}</p>}

            {phase === "edit" && step === "media" && <MediaStep items={items} dragging={dragging} busy={false} onFiles={(f) => void addFiles(f)} onRemove={removeItem} onMakeCover={makeCover} onWrittenOnly={() => { setWrittenOnly(true); setStep("place"); }} cameraSupport={cameraSupport} onCamera={setCamera} />}
            {phase === "edit" && step === "place" && <PlaceStep place={place} spot={spot} precision={precision} onPlace={setPlace} onSpot={setSpot} onPrecision={setPrecision} />}
            {phase === "edit" && step === "details" && (
              <>
                <div className="mb-5 flex justify-center md:hidden">
                  <PostPreview imageUrl={preview} destination={place?.name ?? null} spot={spot} caption={caption} capturedAt={capturedAtFor(when)} precision={precision} isVideo={cover?.type === "video"} photoCount={items.filter((i) => i.media?.type === "image").length} />
                </div>
                <DetailsStep caption={caption} when={when} hasMedia={items.length > 0} onCaption={setCaption} onWhen={setWhen} />
                <div className="mt-6"><ExperiencePicker crowd={crowd} conditions={conditions} vibes={vibes} tip={tip} wantsArea={wantsArea} onCrowd={setCrowd} onConditions={setConditions} onVibes={setVibes} onTip={setTip} onWantsArea={setWantsArea} /></div>
              </>
            )}

            {phase === "uploading" && (
              <div className="tm-rise flex min-h-[320px] flex-col items-center justify-center gap-5 text-center" role="status" aria-live="polite">
                <span className="h-14 w-14 animate-spin rounded-full border-4 border-teal/20 border-t-teal" />
                <div className="w-full max-w-xs">
                  <p className="font-semibold text-pine">{progress.label}</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-teal transition-all duration-500" style={{ width: `${Math.max(8, Math.round((progress.done / Math.max(1, progress.total)) * 100))}%` }} /></div>
                  <p className="mt-3 text-xs text-ink-muted">Please keep this window open.</p>
                </div>
              </div>
            )}

            {phase === "done" && (
              <div className="flex min-h-[340px] flex-col items-center justify-center gap-4 text-center">
                <span className="tm-pop flex h-20 w-20 items-center justify-center rounded-full bg-teal text-white shadow-lg">
                  <svg className="tm-check" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                </span>
                <div className="tm-rise">
                  <p className="font-display text-2xl font-semibold text-pine">Shared to {place?.name}</p>
                  <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink-muted">Travelers browsing {place?.name} can see it now. Thank you for helping the next person decide.</p>
                </div>
                <div className="tm-rise flex flex-wrap justify-center gap-2.5 pt-2">
                  <button type="button" onClick={onClose} className="min-h-12 rounded-full bg-teal px-7 text-sm font-semibold text-white active:scale-95 transition-transform">Done</button>
                  <button type="button" onClick={reset} className="min-h-12 rounded-full border border-line bg-white px-6 text-sm font-semibold text-pine active:scale-95 transition-transform">Share another</button>
                </div>
              </div>
            )}
          </div>

          {phase === "edit" && (
            <footer className="shrink-0 border-t border-line bg-white px-5 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] md:px-7">
              {error && (
                <p role="alert" className="mb-3 rounded-2xl bg-clay-light px-4 py-2.5 text-sm text-clay-ink">
                  {error.message} {error.needsProfile && <Link href="/profile" className="font-semibold underline">Open profile</Link>}
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 flex-1 text-xs text-ink-muted" aria-live="polite">{stop ?? (step === "details" ? "Ready to share" : "Looks good")}</p>
                <button type="button" onClick={next} disabled={stop !== null}
                  className={`min-h-12 shrink-0 rounded-full px-8 text-sm font-semibold shadow-sm transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-45 ${step === "details" ? "bg-marigold text-pine" : "bg-teal text-white"}`}>
                  {step === "details" ? (error ? "Try again" : "Share") : "Continue"}
                </button>
              </div>
            </footer>
          )}
        </section>

        {camera && (
          <CameraCapture key={camera} initialMode={camera}
            onUse={(file) => { setCamera(null); void addFiles([file]); }}
            onClose={() => setCamera(null)}
            onUpload={() => { setCamera(null); setNotice("Choose a photo or video from your device."); }} />
        )}

        {confirmDiscard && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55 p-6" onClick={() => setConfirmDiscard(false)}>
            <div role="alertdialog" aria-modal="true" aria-labelledby="discard-title" onClick={(e) => e.stopPropagation()} className="tm-pop w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
              <h3 id="discard-title" className="font-display text-xl font-semibold text-pine">Discard this post?</h3>
              <p className="mt-1.5 text-sm text-ink-muted">What you&apos;ve added so far won&apos;t be saved.</p>
              <div className="mt-5 flex flex-col gap-2.5">
                <button type="button" autoFocus onClick={() => setConfirmDiscard(false)} className="min-h-12 rounded-full bg-teal text-sm font-semibold text-white">Keep editing</button>
                <button type="button" onClick={onClose} className="min-h-12 rounded-full text-sm font-semibold text-clay-ink hover:bg-clay-light">Discard</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
