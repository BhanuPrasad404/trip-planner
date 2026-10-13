# Product clarity audit

Method: code reading by three passes (Trip Check by hand; planning flows and drive/map/discover by read-only agents). Nothing was
run on a phone and no first-time user was observed, so every "confusing" claim is a judgement from the wording and logic in code.

## Trip Check ("Will it be open when I arrive?")
- **What it does:** you pick a day and a departure date/time; it adds estimated driving time, breaks and earlier visit times to get an
  arrival time per stop, then compares that with opening hours.
- **Core problem (data, not wording):** planned stops have **no opening-hours field**. Hours exist only for nearby suggestions (OpenStreetMap)
  and for hours the traveller types in, which are saved in the browser (`localStorage`), not on the trip or shared with the group. So the
  answer is usually "Hours unverified".
- **Defect fixed:** with no known hours it said "Nothing in your day looks impractical", which reads as an all-clear. Now: "We can't tell yet
  whether your stops will be open."
- **Also fixed:** plain-language intro, why date and time are needed, "saved on this device only", and an "Add its opening hours" button on unverified stops.
- **Proposal (needs approval, not built):** prefill hours from OpenStreetMap (nearest place with a similar name within about 100 m), labelled "from map data, please confirm", and store them on the stop so the group shares them. Needs a matching rule and a schema change.

## Findings

| Pri | Area | Finding | Status |
|---|---|---|---|
| P1 | Trip Check | False all-clear when no hours known | FIXED + test |
| P1 | Builder | Trip without a start point dead-ends ("Set a starting point" but no screen to set it; start can only be chosen at creation) | Message made honest; **missing capability: edit start point** |
| P1 | Duplicates | Manual add / bulk save do not check for an existing place (only import preview does) | OPEN (logic) |
| P1 | Import | "We suggest real places…" overstated AI output | FIXED (copy) |
| P1 | Plan | "Trip readiness 82/100" is only the average Go score | Explanatory line added; name unchanged (tests/UI rely on it) |
| P1 | Navigation | Headline ETA read as exact | FIXED ("arrive about …") |
| P1 | Go score | No scale shown | FIXED ("62/100") |
| P1 | Drive | Location sharing checkbox is pre-ticked (`useState(true)`) | Disclosure added. **Product decision: opt-in would be safer**; tests assert default on, so not changed |
| P1 | Radar / Open status | "Open until 8 pm" shown as fact from unverified OSM data; "not connected" traffic wording; 11 px disclaimers | OPEN (copy/UI) |
| P1 | Reports/blocks | No explanation of what block does; no verified screen to manage blocked users | OPEN (unverified) |
| P2 | Tap targets | Many controls 28–40 px (original-post chip, map preview toggle, quick picks, nav dismiss) | Button `sm` now 44 px on mobile; others OPEN |
| P2 | Wording | "Go score", "Given up first", "Meals & rest (not counted)", "Autopilot", "Smart Stops", "Next best action" unexplained | OPEN (copy) |
| P2 | Accessibility | Nav banner not a live region; alert dialog has no focus move; Helpful/Like double-announce state | OPEN |
| P2 | Location denied | Fatal location errors have no visible fallback action; laptop wording shown to phone users | OPEN |
| P3 | Misc | Empty-state wording, uppercase dates, raw coordinates in search results, "Mark as done & go on" | partly FIXED |

**Checked and found fine:** "Wait for a precise position" works as labelled (real GPS keeps watching after the gate closes);
"Current · 2 hours ago" on feed posts shows its age; camera error handling; "Community-reported, not guaranteed".
**Not verified:** wake-lock fallback, notifications empty state, blocked-users management screen.

## Verification
tsc, eslint, `vitest run`: 126 files, 1599 passed, 8 expected-fail (open audit-52 defects). Three assertions in `tests/trip-check.test.tsx`
were updated because they encoded the misleading all-clear wording. No device or user testing was done.
