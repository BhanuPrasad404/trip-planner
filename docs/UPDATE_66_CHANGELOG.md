# Update 66 — Mobile UI: the whole app, re-skinned for phones

No migration, no new dependency, no cost, **no logic changes**. Phones only (below 768 px); the desktop and tablet look is unchanged. Includes everything from Updates 61–65.

## What changed
- **Whole-app dark "forest at golden hour" theme** from one phone-only block in `app/globals.css`: tokens re-mapped by role, white cards → dark glass, native controls dark, ~30 hard-coded light colours re-mapped one by one, the two-role `--pine` token handled per class with its exceptions named. Every page picks it up, including auth and landing.
- **A scene behind the app** (`MobileBackdrop`): drawn sky, sun, three mountain ridges and pines, fading to deep green. Inline vector: no image, no licence, nothing animated. A one-line slot (`HERO_PHOTO`) takes your own photograph.
- **Phone header**: "TrailMate" with "Plan · Ride · Explore", the avatar, and a search pill ("Search destinations, plan your next ride…") that opens Explore. Not sticky (scrolls away to give the page room); hidden on the live map.
- **Floating glass bottom bar**: inset from the edges and above the home indicator, 64 px tabs, the current tab in marigold with a glowing underline, auto-hide on scroll still works (the bar clears its own margin).
- **Weather & sun card**: a 60 px temperature, a picture for the current hour, evenly spaced hourly tiles with sun / moon / rain pictures from the sun times and rain chance; all of it phones-only and derived from data the card already had.
- Small fits: page bottom padding for the floating bar; the live map's height accounts for it.

## Tests
~55 new/updated: the theme is phone-only and leaves the light theme byte-identical; no blur on cards; **every text colour is checked against every surface over the brightest part of the scene (AA 4.5:1)**; a guard fails if anyone adds a light hard-coded colour without a phone override; header, search pill (shown on live trip, hidden on the live map), nav, tabs, glow, 64 px targets, More menu, desktop sidebar untouched; backdrop decoration-only with no image or outside address; weather pictures phone-only and correct (moon after sunset, rain when likely, nothing guessed). Mutation-checked: 18 deliberate breaks, all caught after two gaps were closed.

## Found by the contrast test and fixed
- The glass was too translucent: over the brightest sunset tinted chips dropped to 4.1:1. Glass is now 90% opaque.
- The red "arrived" flag icon was unreadable on dark glass; it has a lighter replacement.

## NOT verified
- **Never seen on a real phone.** The build environment has no browser, so spacing, the look of the scene behind real content, the glass, and the weather card's proportions are checked by tests, contrast maths and the build, not by eye.
- The backdrop is a **drawn scene, not your photograph**, and has no rider. Use `HERO_PHOTO` for a real image (see `docs/MOBILE_UI.md`).
- Desktop/tablet: unchanged by design, but not re-looked at either.
