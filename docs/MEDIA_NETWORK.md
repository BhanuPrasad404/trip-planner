# Traveler Media Network — decisions and status

Purpose: people who were at a place recently give fresh visual context to people about to go there.
Destination relevance > engagement. Freshness > vanity metrics. Trust > popularity.

## What already existed (and is kept as is)
- `place_reports` — anonymous one-line updates + one photo on a stop (flag ≥3 hides). **Stays anonymous.** It is the quick "what is it like right now" signal.
- `trip_members` — people who share a trip (this is the "private connection" already).
- PostGIS `pois` + radius queries, `consume_quota()`, Storage bucket `report-photos`, Realtime on `live_locations`.
- No profiles, no follows, no video, no public authorship. Identity was deliberately absent.

## Decisions
**1. Identity is opt-in.** A `profiles` row exists only if the person creates one (Profile page → Traveler profile). Posts always carry that profile. Anonymous reports are unchanged, so the "community content never names its author" promise still holds for them.

**2. Relationship model = Follow (+ approval for private profiles).** Friends (mutual) fits chat apps, not discovery: you want a stranger's fresh video of RK Beach without them accepting you. Friends+Following doubles the rules. Group travel is already covered by `trip_members`, so no second "friends" table. A private profile makes follows `pending` until approved; the *database* sets that status, not the client.

**3. Destination = a point + radius, not a new table.** A trip stop / destination already has lat/lng. The feed asks "posts within N km of these points" with PostGIS (`posts.geog`, GiST index). A `destinations` taxonomy can come later if search needs it.

**4. Honest freshness.** Effective time = earlier of *uploaded* and *claimed captured*; never later than now. Only posts under 24 h may be called "current"; older ones are labelled ("3 days ago", "Historical — posted July 2026"). We cannot prove a file was filmed when the poster says; EXIF "verified on site" is a later feature and no "verified" badge exists today.

**5. Location privacy.** Posts default to *approximate* (rounded to ≈1 km by a database trigger, so no client can skip it). Post location is separate from live location (`live_locations` is untouched and never joined to posts).

**6. Moderation (layered).** Upload limits (type/size/duration) → per-user daily quotas → 3 distinct reports hide a post pending review (author still sees it) → human review with the service role. Automated image/video moderation is NOT built yet; a public launch needs it (see below).

## Storage / CDN
| | Supabase Storage (chosen for now) | Cloudflare R2 | Cloudinary |
|---|---|---|---|
| Fit | Already in the stack; RLS-aware; signed upload + read URLs | Separate account, S3 API, presigned URLs | Best image/video transforms |
| Cost shape | Free/low tiers are small and **change**; egress counts | No egress fees (storage + operations billed) | Credit-based; video gets expensive |
| Transcoding | None | None (Cloudflare Stream is separate) | Yes |
| Complexity | Lowest | Medium (own auth rules for private posts) | Medium |

Choice: **Supabase Storage now, behind `lib/social/storage.ts`.** Private bucket, direct browser upload with signed upload URLs (video never passes through Next.js), signed read URLs only for posts the viewer may see. Videos are limited (≤30 s, ≤40 MB, mp4/webm) because nothing transcodes them yet. When egress or storage outgrows the plan, implement `MediaStorage` for R2 and (for adaptive streaming) add Cloudflare Stream or Mux — no route or UI changes. Check your current Supabase plan limits in the dashboard; do not assume they are free forever.

## Built (updates 16)
Migrations 12–13: `profiles`, `follows`, `posts`, `post_media`, `post_likes`, `post_saves`, `post_comments` (one reply level), `post_reports`, RLS, helpers `can_view_post`, `post_stats()`, `follow_counts()`, private bucket `post-media`. Tested on real Postgres + PostGIS as owner/follower/pending/stranger/anon (42 checks).
API: `PUT /api/profile`, `POST|DELETE /api/follows`, `POST /api/posts/upload-url`, `POST /api/posts`. Pure code: `lib/social/{freshness,media,schemas,storage}.ts`. UI: Traveler profile form.

## Not built yet (in order)
1. Destination feed read API (cursor pagination, ranking = freshness × proximity × trust × engagement) + feed UI with lazy video (poster first, `preload="metadata"`, play only in view, one at a time).
2. Create-post UI (pick file → downscale / poster frame → direct upload → post).
3. Like / save / comment / report endpoints + UI (tables + RLS are ready).
4. "Your trip" feed per stop; map & Radar entry points; Live Place Pulse + Autopilot signals from recent posts; community confirmations.
5. Automated moderation, admin review screen, comment reports, blocks/mutes.
6. AI categorisation / report extraction (always labelled "AI-extracted").
