-- PREPARED, NOT APPLIED. Makes "one stored copy of each suggested plan change" a rule of the database, not only of the app.
--
-- Why: the replan "propose" route used to store a NEW proposed revision every time it was asked, so a refresh, a second tap, or two devices
-- at once piled up identical suggestions (and identical "Itinerary change proposed" lines in the traveller's history). The app now gives every
-- proposal a `dedupe_key` (lib/trip/proposal-key.ts), reuses an existing one, and serialises requests inside one server. This index closes the
-- last gap: two SERVER instances answering at the same instant. The loser gets error 23505 on this index and the app reads the winner's row
-- (lib/server/journey-events.ts, recordProposal). Without the index the app still converges on the lowest revision of a key, so nothing is
-- shown twice, but extra unanswered rows can exist after a rare race.
--
-- Safe: additive, partial (only rows of kind 'proposed' that carry a dedupe_key; every older row is outside it), no data is changed or removed.
-- Needs the owner's explicit approval before it is applied.
create unique index if not exists trip_plan_revisions_proposal_key
  on public.trip_plan_revisions (trip_id, (meta ->> 'dedupe_key'))
  where kind = 'proposed' and meta ? 'dedupe_key';
