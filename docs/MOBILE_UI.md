# Mobile UI — "forest at golden hour"

Phones only (below 768 px). Tablets and desktops keep the light theme, byte for byte. It is a presentation layer: no logic, no data, no routes changed.

## How it works
1. **`app/globals.css`, one block after the "MOBILE THEME" banner**, inside `@media (max-width: 767px)`. It re-maps design tokens that have ONE role (text colours, tinted backgrounds, borders), turns white cards into dark glass, switches native controls to dark (`color-scheme: dark`), and handles the few two-role cases by class:
   - `--pine` is both a title colour and a button background → `.text-pine` becomes cream, `.bg-pine` stays deep green, and the marigold buttons keep dark text (named exception).
   - only real surfaces (`bg-white`, `/95 /90 /80 /70 /60 /50`) become glass; the faint white overlays on dark bars (`/5 … /25`) stay highlights.
2. **`components/shell/MobileBackdrop.tsx`**: the sunset-mountains scene behind the whole app (an inline vector: no download, no licence, nothing moves). Mounted once in `app/layout.tsx`.
3. **`components/shell/AppNav.tsx`**: the phone header (TrailMate + "Plan · Ride · Explore", avatar, a search pill linking to Explore) and the floating glass bottom bar with a glowing active tab. Desktop sidebar unchanged.
4. **`components/intel/WeatherSunCard.tsx`**: bigger temperature, a picture for the current hour, evenly spaced hourly tiles with sun / moon / rain pictures (phones only; from data the card already had).

## Use your own photograph
Drop a tall image (about 1170×1400, `.webp` or `.jpg`) into `public/brand/` and set `HERO_PHOTO` at the top of `components/shell/MobileBackdrop.tsx` to its path, e.g. `"/brand/mobile-hero.webp"`. The dark fade below it keeps every card and line of text readable whatever the picture is. Nothing else changes. (The drawn scene is a stand-in: it is not a photograph and has no rider.)

## Rules for adding UI
- Prefer the design tokens (`text-pine`, `text-ink-muted`, `bg-white`, `border-line`, `bg-teal-light`…): they already work on phones.
- A hard-coded colour in a class (`bg-[#…]`, `text-[#…]`, `border-[#…]`) that is light as a background or pale as a border, or dark as text, **needs a matching override in the mobile block**. `tests/mobile-theme.test.ts` fails if one is missing.
- Do not put `backdrop-filter` on cards (it makes `position: fixed` children misbehave and is slow on cheap phones). Use `.tm-glass` only on bars and pills that are themselves fixed or small.
- Contrast is computed, not eyeballed: the same test checks every text colour against every surface over the brightest part of the scene (WCAG AA, 4.5:1).

## Known limits
- Checked by tests and the build, **not seen on a real phone** (no browser in the build environment): spacing, how the sunset sits behind real content, and the feel of the glass need your eyes.
- Light-only components that draw their own colours in JavaScript (map markers, popups, the map itself) are unchanged; they keep their own look.
- Pages outside the app shell (landing, sign-in, legal) get the same dark theme and backdrop through the tokens, but have no search pill or bottom bar.
