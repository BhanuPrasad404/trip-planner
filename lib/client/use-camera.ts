"use client";

import { useCallback, useEffect, useReducer, useRef, type RefObject } from "react";
import { readCameraEnv } from "./camera-env";
import { diagnoseCamera, elapsedAt, initialRec, pickRecorderMime, plainVideoMime, recReducer, reachedLimit, type CameraMode, type Facing } from "./recorder";

/** Everything that touches the real camera. The rules (30 s limit, states, messages) live in recorder.ts and are tested there. */
export function useCamera(initialMode: CameraMode, videoRef: RefObject<HTMLVideoElement | null>) {
  const [state, dispatch] = useReducer(recReducer, initialMode, initialRec);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const banked = useRef(0);
  const startedAt = useRef<number | null>(null);
  const finalMs = useRef(0);
  const stopReason = useRef<"user" | "limit" | "hidden">("user");
  const generation = useRef(0);
  const alive = useRef(true);
  const urls = useRef<string[]>([]);
  const mimeRef = useRef<string>("video/webm");

  const stopStream = useCallback(() => {
    stream.current?.getTracks().forEach((t) => { t.onended = null; t.stop(); }); // switches the camera light off; our own stop is not an "ended" surprise
    stream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [videoRef]);
  const stopTimer = useCallback(() => { if (timer.current) { clearInterval(timer.current); timer.current = null; } }, []);

  const open = useCallback(async (mode: CameraMode, facing: Facing) => {
    const mine = ++generation.current;                              // an older, slower request must never replace a newer one
    dispatch({ type: "starting" });
    stopStream();
    try {
      const video = { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } };
      // A camera that cannot do what we ask (OverconstrainedError) is asked again for "any camera" before giving up:
      // an odd webcam must not mean "no camera".
      const gum = async (c: { video: MediaTrackConstraints | boolean; audio: boolean }) => {
        try { return await navigator.mediaDevices.getUserMedia(c); }
        catch (e) {
          const n = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
          if ((n === "OverconstrainedError" || n === "ConstraintNotSatisfiedError") && c.video !== true) return navigator.mediaDevices.getUserMedia({ ...c, video: true });
          throw e;
        }
      };
      let s: MediaStream; let notice: string | null = null;
      if (mode === "video") {
        try { s = await gum({ video, audio: true }); }
        catch (first) {
          // Only a microphone problem is worth retrying without sound; a camera refusal would just be refused again.
          const n = first && typeof first === "object" && "name" in first ? String((first as { name: unknown }).name) : "";
          if (n === "NotAllowedError" || n === "NotFoundError" || n === "NotReadableError" || n === "OverconstrainedError") {
            try { s = await gum({ video, audio: false }); notice = "Recording without sound — the microphone isn't available."; }
            catch { throw first; }
          } else throw first;
        }
      } else s = await gum({ video, audio: false });
      if (!alive.current || mine !== generation.current) { s.getTracks().forEach((t) => t.stop()); return; }
      stream.current = s;
      // If the camera is taken away (another app, the phone sleeping, the device unplugged) say so instead of freezing on a still frame.
      s.getVideoTracks().forEach((t) => { t.onended = () => { if (alive.current && stream.current === s && recorder.current === null) dispatch({ type: "failed", message: "The camera stopped — another app may have taken it. Tap Try again." }); }; });
      const el = videoRef.current;
      if (el) { el.srcObject = s; await el.play().catch(() => undefined); }
      let cams = 1;
      try { cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput").length; } catch { /* keep 1 */ }
      if (!alive.current || mine !== generation.current) return;
      dispatch({ type: "ready", canSwitch: cams > 1, canPause: typeof MediaRecorder !== "undefined" && typeof MediaRecorder.prototype.pause === "function", notice });
    } catch (e) {
      if (!alive.current || mine !== generation.current) return;
      // Ask the browser WHY (policy, a block set earlier, a closed prompt, https…) so the message can say what to do.
      const env = await readCameraEnv().catch(() => null);
      if (alive.current && mine === generation.current) dispatch({ type: "failed", message: diagnoseCamera(e, env).message });
    }
  }, [stopStream, videoRef]);

  const finishPhoto = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { dispatch({ type: "failed", message: "The camera isn't ready yet. Try again in a moment." }); return; }
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);                         // drawn straight from the camera: not mirrored, no metadata
    c.toBlob((blob) => {
      if (!blob || !alive.current) return;
      const url = URL.createObjectURL(blob); urls.current.push(url);
      stopStream();
      dispatch({ type: "captured", capture: { kind: "photo", blob, url, durationMs: 0, mime: "image/jpeg" } });
    }, "image/jpeg", 0.92);
  }, [stopStream, videoRef]);

  const finalize = useCallback(() => {
    stopTimer();
    const type = plainVideoMime(mimeRef.current) ?? "video/webm";
    const blob = new Blob(chunks.current, { type });
    chunks.current = [];
    recorder.current = null;
    if (!alive.current) return;
    if (blob.size === 0) { dispatch({ type: "failed", message: "Nothing was recorded. Please try again." }); return; }
    const url = URL.createObjectURL(blob); urls.current.push(url);
    stopStream();
    const why = stopReason.current;
    dispatch({ type: "captured", capture: { kind: "video", blob, url, durationMs: finalMs.current, mime: type },
      notice: why === "hidden" ? "Recording stopped because you left the app. Your clip is saved." : why === "limit" ? "You reached the 30-second limit." : null });
  }, [stopStream, stopTimer]);

  const stopRecording = useCallback((why: "user" | "limit" | "hidden" = "user") => {
    const r = recorder.current;
    if (!r || r.state === "inactive") return;
    stopReason.current = why;
    finalMs.current = elapsedAt(banked.current, startedAt.current, performance.now());
    stopTimer();
    try { r.stop(); } catch { finalize(); }
  }, [finalize, stopTimer]);

  const startRecording = useCallback(() => {
    const s = stream.current;
    if (!s || typeof MediaRecorder === "undefined") { dispatch({ type: "failed", message: "This browser can't record video. You can upload one from your device instead." }); return; }
    const mime = pickRecorderMime((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) { dispatch({ type: "failed", message: "This browser can't record video. You can upload one from your device instead." }); return; }
    mimeRef.current = mime;
    let r: MediaRecorder;
    try { r = new MediaRecorder(s, { mimeType: mime, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 96_000 }); }
    catch { try { r = new MediaRecorder(s, { mimeType: mime }); } catch { dispatch({ type: "failed", message: "This browser couldn't start recording. You can upload a video instead." }); return; } }
    chunks.current = []; banked.current = 0; startedAt.current = performance.now(); finalMs.current = 0; stopReason.current = "user";
    r.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
    r.onstop = finalize;
    r.onerror = () => { if (chunks.current.length > 0) { stopReason.current = "user"; finalMs.current = elapsedAt(banked.current, startedAt.current, performance.now()); finalize(); } else dispatch({ type: "failed", message: "Recording stopped unexpectedly. Please try again." }); };
    recorder.current = r;
    r.start(1000);                                                  // chunks arrive every second, so a crash loses at most a second
    dispatch({ type: "record" });
    stopTimer();
    timer.current = setInterval(() => {
      const ms = elapsedAt(banked.current, startedAt.current, performance.now());
      dispatch({ type: "tick", elapsedMs: ms });
      if (reachedLimit(ms)) stopRecording("limit");                 // the hard stop: recording ends by itself at 30 s
    }, 100);
  }, [finalize, stopRecording, stopTimer]);

  const pause = useCallback(() => {
    const r = recorder.current;
    if (!r || r.state !== "recording") return;
    r.pause(); banked.current = elapsedAt(banked.current, startedAt.current, performance.now()); startedAt.current = null;
    dispatch({ type: "pause" });
  }, []);
  const resume = useCallback(() => {
    const r = recorder.current;
    if (!r || r.state !== "paused") return;
    startedAt.current = performance.now(); r.resume();
    dispatch({ type: "resume" });
  }, []);

  const setMode = useCallback((mode: CameraMode) => { dispatch({ type: "mode", mode }); void open(mode, state.facing); }, [open, state.facing]);
  const switchFacing = useCallback(() => { const f: Facing = state.facing === "user" ? "environment" : "user"; dispatch({ type: "facing", facing: f }); void open(state.mode, f); }, [open, state.facing, state.mode]);
  const retake = useCallback(() => {
    if (state.capture) URL.revokeObjectURL(state.capture.url);
    dispatch({ type: "retake" });
    void open(state.mode, state.facing);
  }, [open, state.capture, state.mode, state.facing]);

  useEffect(() => {
    alive.current = true;
    void open(initialMode, "environment");
    const live = urls.current;
    return () => {
      alive.current = false;
      stopTimer();
      const r = recorder.current;
      if (r && r.state !== "inactive") { r.onstop = null; try { r.stop(); } catch { /* already stopped */ } }
      stopStream();
      live.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opened once; later changes go through setMode/switchFacing/retake
  }, []);

  const phaseRef = useRef(state.phase); const modeRef = useRef(state.mode); const facingRef = useRef(state.facing);
  useEffect(() => { phaseRef.current = state.phase; modeRef.current = state.mode; facingRef.current = state.facing; });
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") { stopRecording("hidden"); return; }   // phones suspend the camera when you leave: keep what was recorded
      // Back in the app with the live preview but a dead camera (phones stop it while hidden): start it again by itself.
      const dead = stream.current ? stream.current.getVideoTracks().every((t) => t.readyState === "ended") : false;
      if (phaseRef.current === "live" && dead) void open(modeRef.current, facingRef.current);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [stopRecording, open]);

  return { state, takePhoto: finishPhoto, startRecording, stopRecording, pause, resume, setMode, switchFacing, retake, reopen: () => open(state.mode, state.facing) };
}
