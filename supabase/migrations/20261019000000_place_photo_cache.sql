-- Shared cache: "which real photo shows this place?" — one answer per place, for everyone.
--
-- Why: looking a place up on Wikipedia/Commons costs several requests and a few seconds. Without a shared memory every visit, every
-- user and every server instance repeats that work, and Wikimedia (rightly) throttles bursts. With it, a place is resolved once.
--
-- Additive and optional: a new table nothing else references. The app works without it (it falls back to an in-memory cache), so this
-- migration can be applied at any time, in any order relative to the others.
--
--   key         the place's identity: normalised name + ~1 km cell, e.g. 'charminar@17.36,78.47' (built by lib/place-photos/store.ts)
--   status      'found' (photo is set) or 'none' (reason is set): a "no photo" answer is remembered too, so it is not asked again
--   photo       the verified photo, as JSON (url, srcSet, credit, licence…). The app re-checks every field it reads back.
--   reason      why there is no photo (diagnostics only; never shown to travellers)
--   algo        version of the matching rules that produced the row. When the rules improve, rows with an older version are ignored.
--   expires_at  after this the answer is looked up again (licences and images change)
--
-- Security: public Wikimedia facts only (no personal data). Signed-in users may READ. Nobody signed in can write — not even to their own
-- rows — because a writable cache would let anyone put an arbitrary picture on every other traveller's screen. Only the server's service
-- role writes (it bypasses RLS), after verifying the photo against the same gates a fresh lookup must pass.

create table if not exists public.place_photo_cache (
  key        text primary key check (char_length(key) between 3 and 140),
  name       text not null check (char_length(name) between 1 and 120),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  status     text not null check (status in ('found', 'none')),
  photo      jsonb check (photo is null or (jsonb_typeof(photo) = 'object' and pg_column_size(photo) <= 8192)),
  reason     text check (reason is null or reason in ('no_page', 'far', 'disambiguation', 'no_image', 'image_rejected', 'licence')),
  algo       integer not null default 1 check (algo >= 1),
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- A 'found' row has a photo and no reason; a 'none' row has a reason and no photo. Never both, never neither.
  constraint place_photo_cache_shape check (
    (status = 'found' and photo is not null and reason is null) or (status = 'none' and photo is null and reason is not null)
  )
);

-- Purging expired rows and reading by key are the only access paths.
create index if not exists place_photo_cache_expires_idx on public.place_photo_cache (expires_at);

alter table public.place_photo_cache enable row level security;

drop policy if exists "Signed-in users read photo cache" on public.place_photo_cache;
create policy "Signed-in users read photo cache" on public.place_photo_cache for select to authenticated using (true);

-- No insert / update / delete policy exists, so with RLS on nobody but the service role can write. Take the table privileges away too,
-- so the protection does not rest on RLS alone (defence in depth), and anonymous visitors cannot even read.
revoke all on public.place_photo_cache from anon;
revoke insert, update, delete, truncate on public.place_photo_cache from authenticated;
