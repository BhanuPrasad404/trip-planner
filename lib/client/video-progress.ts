// Turns a video's playhead into meaningful moments: 25 / 50 / 75 % and "finished", once per play-through, plus "replay" when it loops.
// Pure, so the rules are tested without a video element.
export type ProgressEvent = "q25" | "q50" | "q75" | "complete" | "replay";

export function createProgressTracker(emit: (e: ProgressEvent) => void) {
  const fired = new Set<ProgressEvent>();
  let last = 0;
  let loops = 0;
  return {
    update(currentTime: number, duration: number) {
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) return;
      const pct = currentTime / duration;
      // The playhead jumped back after getting near the end = the video looped (a seek by the viewer does not count).
      if (last >= 0.9 && pct < 0.3 && currentTime < last) {
        loops++;
        fired.clear();
        emit("replay");
      }
      last = pct;
      const hit = (e: ProgressEvent, at: number) => { if (pct >= at && !fired.has(e)) { fired.add(e); emit(e); } };
      hit("q25", 0.25); hit("q50", 0.5); hit("q75", 0.75); hit("complete", 0.95);
    },
    loops: () => loops,
  };
}
