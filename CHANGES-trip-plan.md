# Trip plan feature — what changed (expand this zip into the project root; it only replaces/adds files)

Checked before packing: `npm run typecheck` clean · `npm run lint` 0 errors (4 old warnings) · `npm test` 3,712 passed · `next build` OK.

## Plans and days
- A round trip's drive home is its own day (it used to be forced onto the last visit's day, so a far place "never fit").
- "Fits in N days" is shown only after the full plan was run at N and really fits (it used to be a quick guess: "N+1" for ever).
- "Fits" means one thing everywhere; an empty plan never fits. Free days are shown as cards (no more Day 2 → Day 4).
- The three plans agree: Relaxed ≤ Balanced ≤ Most places in places kept; Relaxed doesn't drive more than Balanced
  (900 random trips: order broken in 3.5% before, 0% now). The "what if N days" row for your own length is the plan itself.
- The daylight rule can no longer pull a day's end to an impossible hour. No more "explorer" / "1 days" / "1 of your 2 days have".

## Preferences that now change the plan
- Avoid long drives → at most 4 h 30 min of driving a day. Avoid very early starts → no day before 9:00.
- Avoid long walks/treks → treks and activities go first when something must be left out. "Avoid driving at night" always wins.
- Stay: hostel → a city for the night; homestay/camping → the nearest village; hotel/resort → as before.
- Bus/train: the plan says plainly it uses car road times and has no timetables.
- Questions are asked by how much they change the plan; "stay" is not asked on 1-day trips; "crowded places" is no longer offered (no data).

## Time
- The plan screen knows today: dates over, day 1 already late, trip in progress. Past days are marked done. "Start tomorrow" is one tap,
  never automatic.

## AI and voice
- "The AI didn't answer in time": the Flash model was left thinking (slow). It is now asked not to think in whichever way the model
  accepts; the wait is 22 s and the request is stopped at the end.
- Voice: the real reason for every failure, live words, keeps listening through pauses, and a backup "Record instead" that works in any
  browser (needs AI_PROVIDER=gemini): POST /api/intake/voice (guest route, rate-limited, WAV only, max 45 s, nothing stored).

## To test on the phone
1. Tirupati → Nalgonda, round trip, Most places at 2, 3, 4, 8 days: fits every time, no "choose one more day".
2. Compare the plans: Most places never shows fewer places than Relaxed.
3. Voice on Chrome, then on Brave or Firefox (the backup), in English and Telugu.
4. A trip starting today, opened in the afternoon: the banner and "Start tomorrow".
