// HOW an arrival cue reaches the traveller, decided in one place (the channels are passed in, so every rule is tested):
//   • Trailmate on screen: the chime and the voice (unless the traveller muted drive sounds), and a buzz (unless they turned it off).
//   • Trailmate in the background or the screen off: a page cannot play sound reliably there, so the phone's own notification
//     (when the traveller allowed it) is the only honest channel.
//   • A drive the traveller started is not silenced by quiet hours; their mute and "alerts off" always win.
import type { AlertPrefs } from "@/lib/alerts/prefs";
import type { AppAlert } from "@/lib/alerts/delivery";
import type { ChimeKind } from "./drive-audio";

export type CueText = { title: string; spoken: string; body: string };
export type CueChannels = {
  chime: (k: ChimeKind) => boolean;
  vibrate: (k: ChimeKind) => boolean;
  speak: (text: string) => void;
  notify: ((a: AppAlert) => boolean) | null;
  later: (fn: () => void, ms: number) => void;
  /** Asked again when the voice is about to speak: muting during the chime must silence the voice too. */
  stillOn: () => boolean;
};
export type CueOutcome = { via: "notification" | "screen"; chimed: boolean; buzzed: boolean; spoke: boolean };

/** Time between the end of the chime and the voice, so they do not talk over each other. */
export const SPEAK_AFTER_CHIME_MS = 900;

export function deliverCue(kind: ChimeKind, id: string, text: CueText, ctx: { hidden: boolean; soundOn: boolean; prefs: AlertPrefs | null }, ch: CueChannels): CueOutcome {
  if (ctx.hidden) {
    ch.notify?.({ id: `${kind}:${id}`, kind: "arrival", level: 2, title: text.title, body: text.body, inApp: false, cooldownMs: 12 * 3_600_000, duringDrive: true });
    return { via: "notification", chimed: false, buzzed: false, spoke: false };
  }
  const alertsOn = ctx.prefs?.enabled !== false;
  const chimed = ctx.soundOn && alertsOn ? ch.chime(kind) : false;
  const buzzed = alertsOn && ctx.prefs?.haptics !== false ? ch.vibrate(kind) : false;
  if (ctx.soundOn) ch.later(() => { if (ch.stillOn()) ch.speak(text.spoken); }, chimed ? SPEAK_AFTER_CHIME_MS : 0);
  return { via: "screen", chimed, buzzed, spoke: ctx.soundOn };
}

/** What is shown and said when the traveller is about to reach a stop. */
export function approachText(name: string, distanceM: number): CueText {
  const m = Math.max(10, Math.round(distanceM / 10) * 10);
  return { title: `Arriving at ${name} in ${m} m`, spoken: `Arriving at ${name} in ${m} metres`, body: "Get ready to stop." };
}

/** What is shown and said on arrival. A large place (a fort, a lake) is reached as an area, not a pin. */
export function arrivedText(name: string, area: boolean): CueText {
  const title = area ? `You've reached the ${name} area` : `You have arrived at ${name}`;
  return { title, spoken: title, body: "Open Trailmate to mark it as done." };
}
